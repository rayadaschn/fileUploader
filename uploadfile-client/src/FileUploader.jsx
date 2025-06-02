import { useRef } from "react";
import { InboxOutlined } from "@ant-design/icons";
import "./FileUploader.css"; // Assuming you have a CSS module for styles
import useDrag from "./useDrag";
import { Button, message } from "antd";
import { CHUNK_SIZE } from "./constant";
import axiosInstance from "./axiosInstance";

/**
 *
 * @returns {JSX.Element} 文件上传组件
 * @description 该组件支持拖拽上传文件，支持图片和视频预览，计算文件的 hash 值作为文件名
 * @example <FileUploader />
 */
function FileUploader() {
  const uploaderRef = useRef(null);
  const { fileInfo, selectedFile } = useDrag(uploaderRef);

  const handleUpload = async () => {
    if (!selectedFile) {
      return message.error("请先选择或拖拽文件");
    }

    const filename = await getFileName(selectedFile);
    const chunks = await uploadFile(selectedFile, filename);
    console.log("🚀 ~ handleUpload ~ chunks:", chunks);
  };
  const renderButton = () => {
    return <Button onClick={handleUpload}>上传文件</Button>;
  };
  return (
    <>
      <div className="fileUploaderContainer" ref={uploaderRef}>
        {renderFilePreview(fileInfo)}
      </div>
      {renderButton()}
    </>
  );
}

async function uploadFile(file, fileName) {
  // 对文件进行切片
  const chunks = createFileChunks(file, fileName, CHUNK_SIZE);

  // 实现并行上传
  const request = chunks.map(({ chunk, chunkFileName }) => {
    return createRequest(filename, chunkFileName, chunk);
  });

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
  } catch (error) {
    message.error("文件上传失败:", error.message);
  }
}

function createRequest(filename, chunkFileName, chunk) {
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
