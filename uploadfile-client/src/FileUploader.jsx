import { useRef, useState } from "react";
import { InboxOutlined } from "@ant-design/icons";
import "./FileUploader.css"; // Assuming you have a CSS module for styles
import useDrag from "./useDrag";
import { Button, message, Progress } from "antd";
import { CHUNK_SIZE } from "./constant";
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
  const [cancelTokens, setCancelTokens] = useState({});

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

    const filename = await getFileName(selectedFile);
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
  setCancelTokens
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
      message.warning("文件上传已取消");
    } else {
      message.error("文件上传失败");
    }
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

/** 依据文件对象获取根据文件内容得到的 hash 文件名 */
async function getFileName(file) {
  // 计算此文件的 hash 值
  const fileHash = await calculateFileHash(file);
  // 获取文件拓展名
  const fileExtension = file.name.split(".").pop();
  // 使用 hash 值生成文件名
  return `${fileHash}.${fileExtension}`;
}

/** 计算文件的 hash 文件名 */
async function calculateFileHash(file) {
  const buffer = await file.arrayBuffer(); // 将文件转换为 ArrayBuffer
  // 使用 SubtleCrypto API 计算 SHA-256 哈希
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  // 将 ArrayBuffer 转换为十六进制字符串
  // 这里使用了 Uint8Array 来处理 ArrayBuffer
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
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
