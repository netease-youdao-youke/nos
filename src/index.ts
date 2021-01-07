// import { defaultConfig } from './config';
import { Config, FileObj, uploadParam, getOffsetParam } from './types';
import md5 from 'crypto-js/md5';
import axios from 'axios';

class Uploader {
  /** 接口版本号，当前支持1.0 */
  readonly version: string = '1.0';
  uploadFile!: FileObj;
  edgeNodeList: Array<any> = [];
  dnsRetryCount: number = 0;
  uTRetryCount: number;
  gORetryCount: number;
  gDRetryCount: number;
  urlDns: string = 'https://lbs-eastchina1.126.net/lbs';
  retryCount: number = 2;
  fileInputID: string = 'fileInput';
  timeout: number = 50000;

  constructor (options: Config) {
    this.uTRetryCount = options.retryCount ? options.retryCount : this.retryCount;
    this.gORetryCount = options.retryCount ? options.retryCount : this.retryCount;
    this.gDRetryCount = options.retryCount ? options.retryCount : this.retryCount;
    this.urlDns = options.urlDns ? options.urlDns : this.urlDns;
    this.fileInputID = options.fileInputID ? options.fileInputID : this.fileInputID;
    this.timeout = options.timeout ? options.timeout : this.timeout;
  }

  private clearStorage (bucketName: string, objectName: string, fileKey: string) {
    localStorage.removeItem(`${fileKey}_progress`);
    localStorage.removeItem(`${fileKey}_${bucketName}_${objectName}_context`);
  }

  private getDNS (bucketname: string): Promise<any> {
    if (this.edgeNodeList) {
      return new Promise(() => {
        return this.edgeNodeList;
      })
    } else {
      return axios
        .get(this.urlDns, {
          params: {
            version: this.version,
            bucketname,
          },
        })
        .then((response) => {
          const data = response.data;
          if (data.code) {
            console.error(data);
          } else {
            this.edgeNodeList = data.upload;
            return data.upload;
          }
        })
        .catch((response) => {
          if (response.status.toString().match(/^5/) && this.gDRetryCount > 0 && this.gDRetryCount < this.retryCount + 1) {
            this.gDRetryCount--;
            return this.getDNS(bucketname);
          } else {
            console.error(response.responseText);
            this.gDRetryCount = this.retryCount;
          }
        });
    }
  }

  private getOffset (param: getOffsetParam): Promise<any> {
    const context = localStorage.getItem(`${param.fileKey}_${param.bucketName}_${param.objectName}_context`);
    if (!context) {
      return new Promise(() => {
        return 0;
      })
    }
    return axios
      .get(`${param.serveIp}/${param.bucketName}/${encodeURIComponent(param.objectName)}?uploadContext`, {
        data: {
          version: this.version,
          context,
        },
        headers: {
          'x-nos-token': param.token,
        },
      })
      .then((response) => {
        const data = response.data;
        if (data.errCode) {
          console.error(data);
        } else {
          return data.offset;
        }
      })
      .catch((response) => {
        if (response.status.toString().match(/^5/) && this.gORetryCount > 0 && this.gORetryCount < this.retryCount + 1) {
          this.gORetryCount--;
          return this.getOffset(param);
        } else {
          console.error(response.responseText);
          this.gORetryCount = this.retryCount;
          if (response.status === 404) {
            this.clearStorage(param.bucketName, param.objectName, param.fileKey);
          }
        }
      });
  }

  private uploadTrunk (param: any, trunkData: any): Promise<any> {
    const curFile: FileObj = this.uploadFile;
    const context: string = localStorage.getItem(`${trunkData.fileKey}_${param.bucketName}_${param.objectName}_context`) || '';
    const slice: Blob = File.prototype.slice(trunkData.file, trunkData.offset, trunkData.trunkEnd);
    const formData = new FormData();
    formData.append('file', slice);
    formData.append('name', trunkData.file.name);

    return axios.post(`${param.serveIp}/${param.bucketName}/${encodeURIComponent(param.objectName)}`, formData, {
      params: {
        offset: trunkData.offset,
        complete: trunkData.trunkEnd >= trunkData.file.size,
        context: context || trunkData.context,
        version: this.version
      },
      headers: {
        'x-nos-token': param.token,
        'Content-Type': 'multipart/form-data'
      },
      timeout: this.timeout,
      onUploadProgress: (progressEvent: any) => {
        let progress: number = 0;
        if (progressEvent.lengthComputable) {
          progress = (trunkData.offset + progressEvent.loaded) / trunkData.file.size;
          this.uploadFile.progress = Number((progress * 100).toFixed(2));
          if (progress > 0 && progress < 1) {
            this.uploadFile.status = 1;
            document.getElementById(this.fileInputID)?.setAttribute('disabled', 'disabled');
          } else if (progress === 1) {
            curFile.status = 2;
            document.getElementById(this.fileInputID)?.removeAttribute('disabled');
          }
          localStorage.setItem(`${trunkData.fileKey}_progress`, this.uploadFile.progress.toString());
          console.log(curFile);
        } else {
          console.error('浏览器不支持进度事件');
        }
      }
    })
    .then(response => {
      const {data} = response.data;
      if (curFile.file.size === 0) {
        curFile.status = 2;
        curFile.progress = 100.0;
        console.log(curFile);
      }
      localStorage.setItem(`${trunkData.fileKey}_${param.bucketName}_${param.objectName}_context`, data.context);
      if (data.offset < trunkData.file.size) {
        //上传下一片
        return this.uploadTrunk(
          param,
          Object.assign({}, trunkData, {
            offset: data.offset,
            trunkEnd: data.offset + trunkData.trunkSize,
            context: context || data.context,
          })
        );
      } else {
        //单文件上传结束
        return trunkData;
      }
    })
    .catch(err => {
      //服务器出错重试
      if (err.response.status >= 500) {
        if (this.uTRetryCount < this.retryCount + 1 && this.uTRetryCount > 0) {
          //同一个边缘节点重试两次
          this.getOffset(
            {
              serveIp: param.serveIp,
              bucketName: param.bucketName,
              objectName: param.objectName,
              token: param.token,
              fileKey: trunkData.fileKey,
            },
          )
          .then((offset) => {
            return this.uploadTrunk(
              param,
              Object.assign({}, trunkData, {
                offset: offset,
                trunkEnd: offset + trunkData.trunkSize,
                context: localStorage.getItem(`${trunkData.fileKey}_${param.bucketName}_${param.objectName}_context`) || '',
              }),
            );
          });
          this.uTRetryCount--;
        }
        else if (this.dnsRetryCount < this.edgeNodeList.length - 1) {
          //重试边缘节点
          this.uTRetryCount = this.retryCount;
          this.dnsRetryCount++;
          const param1 = Object.assign({}, param, {
            serveIp: this.edgeNodeList[this.dnsRetryCount],
          });
          this.getOffset(
            {
              serveIp: param1.serveIp,
              bucketName: param1.bucketName,
              objectName: param1.objectName,
              token: param1.token,
              fileKey: trunkData.fileKey,
            }
          )
          .then((offset) => {
            return this.uploadTrunk(
              param1,
              Object.assign({}, trunkData, {
                offset: offset,
                trunkEnd: offset + trunkData.trunkSize,
                context: localStorage.getItem(`${trunkData.fileKey}_${param.bucketName}_${param.objectName}_context`) || '',
              })
            );
          });
        } else {
          //重试完输出错误信息
          this.dnsRetryCount = 0;
          console.error(err);
          document.getElementById(this.fileInputID)?.setAttribute('disabled', 'disabled');
          this.clearStorage(param.bucketName, param.objectName, trunkData.fileKey);
        }
      }
      else {
        document.getElementById(this.fileInputID)?.removeAttribute('disabled');
        if (err.response.status) {
          this.clearStorage(param.bucketName, param.objectName, trunkData.fileKey);
          console.error(err);
        } else {
          console.log('上传已暂停');
        }
      }
    });
  }

  addFile (file: File) {
    return new Promise(() => {
      const fileKey: string = md5(`${file.name}:${file.size}`).toString();
      const fileObj: FileObj = {
        fileKey,
        file,
        fileName: file.name,
        status: 0,
        progress: parseInt(localStorage.getItem(`${fileKey}_progress`) || '0', 10),
      };
      this.uploadFile = Object.assign(true, {}, fileObj);
      return fileObj;
    });
  }

  upload (param: uploadParam) {
    if (!param.trunkSize) {
      param.trunkSize = 128 * 1024;
    }
    if (!this.uploadFile) {
      console.error('未选择需上传的文件');
      return;
    }

    const curFile = this.uploadFile;
    return this.getDNS(param.bucketName).then(edgeNodeList => {
      if (edgeNodeList.length === 0) {
        throw new Error('暂无边缘节点');
      }
      return edgeNodeList
    })
    .then((edgeNodeList) => {
      return this.getOffset(
        {
          serveIp: edgeNodeList[0],
          bucketName: param.bucketName,
          objectName: param.objectName,
          fileKey: curFile.fileKey,
          token: param.token,
        })
        .then((offset) => {
          this.uploadTrunk(
            {
              serveIp: edgeNodeList[0],
              bucketName: param.bucketName,
              objectName: param.objectName,
              token: param.token,
            },
            {
              file: curFile.file,
              fileKey: curFile.fileKey,
              offset: offset || 0,
              trunkSize: param.trunkSize,
              trunkEnd: (offset || 0) + param.trunkSize,
              context: '',
            }
          )
          .then((trunkData) => {
            this.clearStorage(param.bucketName, param.objectName, trunkData.fileKey);
            return curFile;
          })
        })
    });
  }

  pauseUpload () {
    if (!this.uploadFile) {
      console.error('未选择需上传的文件');
    }
    else if (!this.uploadFile.xhr) {
      console.error('当前文件未开始上传');
    }
    else if (this.uploadFile.status < 2) {
      const xhr = this.uploadFile.xhr;
      xhr.abort();
      document.getElementById(this.fileInputID)?.removeAttribute('disabled');
    }
    else {
      console.error('当前文件已完成上传');
    }
  }

}
module.exports = Uploader;
