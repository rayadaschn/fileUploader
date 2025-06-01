import { useRef } from "react";
import { InboxOutlined } from "@ant-design/icons";
import "./FileUploader.css"; // Assuming you have a CSS module for styles
import useDrag from "./useDrag";

function FileUploader() {
  const uploaderRef = useRef(null);
  const { fileInfo } = useDrag(uploaderRef);

  return (
    <>
      <div className="fileUploaderContainer" ref={uploaderRef}>
        {renderFilePreview(fileInfo)}
      </div>
    </>
  );
}

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

function renderImagePreview({ url, fileName }) {
  return (
    <div className="filePreview">
      <img src={url} alt={fileName} className="imagePreview" />
      <p>{fileName}</p>
    </div>
  );
}
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
