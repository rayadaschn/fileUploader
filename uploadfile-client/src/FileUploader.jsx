import { useRef, useState, useEffect } from "react";
import { InboxOutlined } from "@ant-design/icons";
import "./FileUploader.css"; // Assuming you have a CSS module for styles
import useDrag from "./useDrag";
import { Button, message, Progress, Spin } from "antd";
import { CHUNK_SIZE, MAX_RETRIES } from "./constant";
import axiosInstance from "./axiosInstance";
import axios from "axios";

const UploadStatus = {
  NOT_STARTED: "not_started", // 上传未开始
  UPLOADING: "uploading", // 上传中
  COMPLETED: "completed", // 上传完成
  PAUSED: "paused", // 上传暂停
};

/**
 *
 * @returns {JSX.Element} 文件上传组件
 * @description 该组件支持拖拽上传文件，支持图片和视频预览，计算文件的 hash 值作为文件名
 * @example <FileUploader />
 */
function FileUploader() {
  const uploaderRef = useRef(null);
  const { fileInfo, selectedFile, resetFileStatus } = useDrag(uploaderRef);
  const [uploadProgress, setUploadProgress] = useState(null);
  // 控制上传状态
  const [uploadStatus, setUploadStatus] = useState(UploadStatus.NOT_STARTED);
  // 存放所有上传请求的取消令牌
  const [cancelTokens, setCancelTokens] = useState({});
  // 设置 filenameWorker
  const [filenameWorker, setFilenameWorker] = useState(null);
  useEffect(() => {
    // 这里的文件路径是相对于 public 目录的, 因为 Worker 会在浏览器中运行
    // 使用 import.meta.url 来获取当前模块的 URL, 以在 vite 中正确解析 Worker 的路径
    const worker = new Worker(new URL("./filenameWorker.js", import.meta.url));

    setFilenameWorker(worker);
    return () => {
      worker.terminate(); // 清理 Worker
      setFilenameWorker(null);
    };
  }, []);
  // 计算文件名的状态
  const [isCalculatingFileName, setIsCalculatingFileName] = useState(false);

  // 重置状态
  const resetAllStatus = () => {
    resetFileStatus();
    setUploadProgress(null);
    setUploadStatus(UploadStatus.NOT_STARTED);
    setCancelTokens({});
  };
  const handleUpload = async () => {
    if (!selectedFile) {
      return message.error("请先选择或拖拽文件");
    }

    // const filename = await getFileName(selectedFile);
    // 这里改用 Worker 来计算文件名
    filenameWorker.postMessage({ file: selectedFile });
    setIsCalculatingFileName(true);

    // 监听 Worker 返回的文件名
    filenameWorker.onmessage = async (event) => {
      const { filename } = event.data;
      setIsCalculatingFileName(false);

      const chunks = await uploadFile(
        selectedFile,
        filename,
        setUploadProgress,
        resetAllStatus,
        setUploadStatus,
        setCancelTokens
      );
      console.log("🚀 ~ handleUpload ~ chunks:", chunks);
    };
  };

  // 处理上传状态变化
  const pauseUpload = () => {
    setUploadStatus(UploadStatus.PAUSED);
    // 取消上传逻辑
    cancelTokens.forEach((cancelToken) => {
      cancelToken.cancel();
    });
  };

  const resumeUpload = () => {
    setUploadStatus(UploadStatus.UPLOADING);
    // 重新上传逻辑
    handleUpload();
  };

  const renderButton = () => {
    switch (uploadStatus) {
      case UploadStatus.NOT_STARTED:
        return <Button onClick={handleUpload}>开始上传</Button>;
      case UploadStatus.UPLOADING:
        return <Button onClick={pauseUpload}>暂停上传</Button>;
      case UploadStatus.PAUSED:
        return (
          <Button onClick={resumeUpload} type="primary">
            恢复上传
          </Button>
        );
      default:
        return null;
    }
  };
  const renderProgressBar = (progress) => {
    if (progress === null || uploadStatus === UploadStatus.NOT_STARTED)
      return null;

    const percents = Object.values(progress);
    console.log("🚀 ~ renderProgressBar ~ percents:", percents);
    const totalPercent = Math.round(
      percents.reduce((acc, curr) => acc + curr, 0) / percents.length
    );
    return (
      <div className="progressBarContainer">
        <div className="progressBarLabel">上传进度{totalPercent}</div>
        <Progress percent={totalPercent} />
      </div>
    );
    // return Object.keys(progress).map((chunkFileName, index) => {
    //   const percent = progress[chunkFileName];
    //   return (
    //     <div key={index} className="progressBar">
    //       <div className="progressBarLabel">{chunkFileName}</div>
    //       <Progress percent={percent} />
    //     </div>
    //   );
    // });
  };
  return (
    <>
      <div className="fileUploaderContainer" ref={uploaderRef}>
        {renderFilePreview(fileInfo)}
      </div>
      {renderButton()}
      {isCalculatingFileName && <Spin tip="计算文件名中..."> </Spin>}
      {renderProgressBar(uploadProgress)}
    </>
  );
}

async function uploadFile(
  file,
  fileName,
  setUploadProgress,
  resetAllStatus,
  setUploadStatus,
  setCancelTokens,
  retryCount = 0
) {
  // 检查文件是否已存在
  const { exists, uploadedList } = await axiosInstance.get("/check", {
    params: {
      filename: fileName,
    },
  });

  if (exists) {
    message.error("文件已存在，请勿重复上传");
    resetAllStatus(); // 重置状态
    return;
  }
  // 对文件进行切片
  const chunks = createFileChunks(file, fileName, CHUNK_SIZE);

  // 设置中断状态
  const newCancelTokens = [];

  // 实现并行上传
  const request = chunks.map(({ chunk, chunkFileName }) => {
    const cancelToken = axios.CancelToken.source();
    newCancelTokens.push(cancelToken);
    // 这里要校验是否已经上传一部分
    const alreadyUploaded = uploadedList.find(
      (item) => item.chunkFileName === chunkFileName
    );
    // 判断是否已经上传完成, 还是上传了一部分
    if (alreadyUploaded) {
      const uploadedSize = alreadyUploaded.size;
      // 从 chunk 中进行截取, 过滤掉已经上传过的大小
      const remainingChunk = chunk.slice(uploadedSize);
      // 如果剩余的分片大小为 0, 则不需要上传
      if (remainingChunk.size === 0) {
        return Promise.resolve(); // 如果没有剩余分片, 则直接返回已完成的 Promise
      }
      // 如果有剩余分片, 则继续上传
      chunk = remainingChunk;
    }

    return createRequest(
      fileName,
      chunkFileName,
      chunk,
      setUploadProgress,
      cancelToken
    );
  });

  // 更新取消令牌状态
  setCancelTokens(newCancelTokens);
  // 设置上传状态为上传中
  setUploadStatus(UploadStatus.UPLOADING);

  try {
    // 并行上传每个分片
    await Promise.all(request);
    // 等全部分片上传完成, 会向服务器发送一个合并文件的请求
    await axiosInstance.get("/merge", {
      params: {
        filename: fileName,
      },
    });
    message.success("文件上传成功");
    resetAllStatus(); // 重置状态
  } catch (error) {
    // 判断是否为用户主动取消
    if (axios.isCancel(error)) {
      return message.warning("文件上传已取消");
    }

    // 如果是其他错误, 则判断是否重试次数超过最大重试次数
    if (retryCount < MAX_RETRIES) {
      message.error(
        `文件上传失败，正在重试...(${retryCount + 1}/${MAX_RETRIES})`
      );
      // 递归调用上传函数, 增加重试次数
      return uploadFile(
        file,
        fileName,
        setUploadProgress,
        resetAllStatus,
        setUploadStatus,
        setCancelTokens,
        retryCount + 1
      );
    }

    message.error("文件上传失败");
  }
}

function createRequest(
  filename,
  chunkFileName,
  chunk,
  setUploadProgress,
  cancelToken
) {
  return axiosInstance.post("/upload", chunk, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": filename,
      "X-Chunk-Name": chunkFileName,
    },
    params: {
      filename,
      chunkFileName,
    },
    onUploadProgress: (progressEvent) => {
      // progressEvent 是一个 ProgressEvent 对象, 包含上传进度信息
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total
      );
      setUploadProgress((prevProgress) => ({
        ...prevProgress,
        [chunkFileName]: percentCompleted,
      }));
    },
    cancelToken: cancelToken.token, // 添加取消令牌
  });
}

/** 创建文件切片
 * @param {File} file - 要上传的文件对象
 * @param {string} fileName - 文件名
 * @param {number} chunkSize - 切片大小，默认为 1MB
 * @returns {Array} - 返回一个包含文件切片的数组，每个切片包含 chunk 和 chunkFileName
 */
function createFileChunks(file, fileName, chunkSize = 1024 * 1024) {
  const chunks = [];
  let currentPosition = 0;

  while (currentPosition < file.size) {
    const chunk = file.slice(currentPosition, currentPosition + chunkSize);
    chunks.push({
      chunk,
      chunkFileName: `${fileName}.part${currentPosition / chunkSize}`,
    });
    currentPosition += chunkSize;
  }

  return chunks;
}

/** 渲染文件预览 */
function renderFilePreview(fileInfo) {
  const { url, fileType } = fileInfo;
  if (!url || !fileType) return <InboxOutlined />;

  if (fileType.startsWith("image/")) {
    return renderImagePreview(fileInfo);
  }
  if (fileType.startsWith("video/")) {
    return renderVideoPreview(fileInfo);
  }
}

/** 渲染图片预览 */
function renderImagePreview({ url, fileName }) {
  return (
    <div className="filePreview">
      <img src={url} alt={fileName} className="imagePreview" />
      <p>{fileName}</p>
    </div>
  );
}

/** 渲染视频预览 */
function renderVideoPreview({ url, fileName }) {
  return (
    <div className="filePreview">
      <video controls className="videoPreview">
        <source src={url} type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <p>{fileName}</p>
    </div>
  );
}

export default FileUploader;
