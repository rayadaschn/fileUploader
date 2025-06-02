import axios from "axios";

const axiosInstance = axios.create({
  baseURL: "http://localhost:8000/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.response.use(
  (response) => {
    if (response.data && response.data.success) {
      // 如果响应数据中有 success 字段且为 true，则直接返回数据
      return response.data;
    } else {
      // 否则抛出错误
      return Promise.reject(new Error(response.data.message || "请求失败"));
    }
  },
  (error) => {
    // 处理错误
    if (error.response) {
      // 请求已发出，服务器响应了状态码，但状态码超出了 2xx 的范围
      console.error("Response error:", error.response.data);
    } else if (error.request) {
      // 请求已发出，但没有收到响应
      console.error("Request error:", error.request);
    } else {
      // 其他错误
      console.error("Error:", error.message);
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
