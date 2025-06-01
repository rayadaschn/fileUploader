import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FileUploader from "./FileUploader.jsx";
import "@ant-design/v5-patch-for-react-19";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <FileUploader />
  </StrictMode>
);
