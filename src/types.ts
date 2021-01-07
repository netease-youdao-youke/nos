interface curFile {
  status: string,
  progress: string
}

export interface Config {
  /** 获取DNS列表的URL */
  urlDns: string,
  /** 重试次数 */
  retryCount: number,
  /** 文件Input ID */
  fileInputID: string,
  /** Ajax超时时间毫秒 */
  timeout: number
}

export interface FileObj {
  xhr: any;
  /** 文件名与文件大小的MD5值 */
  fileKey:string,
  /** 文件对象 */
  file:File,
  /** 文件名 */
  fileName: string,
  /** 文件状态（ 0 未上传  1 正在上传  2 已上传） */
  status:number,
  /** 上传进度（保留两位小数的百分比） */
  progress:number
}

export interface uploadParam {
  bucketName: string,
  objectName: string,
  token: string,
  trunkSize?: number
}

export interface getOffsetParam {
  serveIp: string,
  fileKey: string,
  bucketName: string,
  objectName: string,
  token: string
}
