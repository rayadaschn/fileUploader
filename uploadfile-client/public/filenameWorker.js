// 在 Web Worker 里，self 是全局作用域的引用，相当于浏览器主线程里的 window。
// 在 Worker 作用域中没有 window，而且 this 的指向可能会因为不同的调用方式而变化，不总是全局对象。
console.log("🚀 ~ filenameWorker.js ~ Worker started");

self.addEventListener("message", async (event) => {
  console.log("🚀 ~ self.addEventListener ~ event:", event);
  const { file } = event.data;
  const filename = await getFileName(file);
  console.log("🚀 ~ self.addEventListener ~ filename:", filename);

  // 将计算得到的文件名发送回主线程
  self.postMessage({ filename });
});

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
