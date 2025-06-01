import { useCallback, useEffect, useState } from "react";
import { message } from "antd";
import { MAX_FILE_SIZE, SUPPORTED_FORMATS } from "./constant";

function useDrag(uploadRef) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInfo, setFileInfo] = useState({ url: null, fileName: null });

  const checkFile = (files) => {
    const file = files[0];

    // Check if the file is selected and meets the size requirements
    if (!file) {
      return message.error("No file selected");
    }
    if (!SUPPORTED_FORMATS.includes(file.type)) {
      return message.error(
        `Unsupported file format. Supported formats are: ${SUPPORTED_FORMATS.join(
          ", "
        )}`
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return message.error(
        `File size exceeds the limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB`
      );
    }

    // If all checks pass, set the selected file
    setSelectedFile(file);
  };

  const handleDrag = useCallback((event) => {
    event.preventDefault(); // Prevent default behavior to allow drop
    event.stopPropagation(); // Stop propagation to prevent the event from bubbling up
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const { files } = event.dataTransfer; // dataTransfer is the object that contains the files being dragged
    checkFile(files); // Check the files being dragged
    console.log("Files dropped:", files);
  }, []);

  useEffect(() => {
    const uploadContainer = uploadRef.current;
    uploadContainer.addEventListener("dragenter", handleDrag);
    uploadContainer.addEventListener("dragover", handleDrag);
    uploadContainer.addEventListener("drop", handleDrop);
    uploadContainer.addEventListener("dragleave", handleDrag);
    return () => {
      uploadContainer.removeEventListener("dragenter", handleDrag);
      uploadContainer.removeEventListener("dragover", handleDrag);
      uploadContainer.removeEventListener("drop", handleDrop);
      uploadContainer.removeEventListener("dragleave", handleDrag);
    };
  }, [uploadRef, handleDrag, handleDrop]);

  // setPreview
  useEffect(() => {
    if (!selectedFile) return;

    const url = URL.createObjectURL(selectedFile);
    setFileInfo({
      url: url,
      fileName: selectedFile.name,
      fileType: selectedFile.type,
      fileSize: selectedFile.size,
    });

    return () => {
      URL.revokeObjectURL(url); // Clean up the object URL to avoid memory leaks
    };
  }, [selectedFile]);

  return { fileInfo, selectedFile };
}

export default useDrag;
