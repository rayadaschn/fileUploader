const express = require("express");
const logger = require("morgan");
const {} = require("http-status-codes");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const { Transform } = require("stream");
const PUBLIC_DIR = path.join(__dirname, "public");
const TEMP_DIR = path.join(__dirname, "temp");
const { CHUNK_SIZE } = require(path.join(__dirname, "./constant.js"));

// 开始创建 app
const app = express();
// 设置日志记录
app.use(logger("dev"));
// 允许跨域请求
app.use(cors());
// 解析 JSON 请求体
app.use(express.json());
// 解析 URL 编码的请求体
app.use(express.urlencoded({ extended: true }));
// 设置静态文件目录
app.use("/static", express.static(path.join(__dirname, "public")));
fs.ensureDirSync(path.join(__dirname, "public"));

// 慢速写入 Transform 流
class SlowTransform extends Transform {
  _transform(chunk, encoding, callback) {
    setTimeout(() => {
      this.push(chunk);
      callback();
    }, 10); // 每个 chunk 延迟 10ms，可根据需要调整
  }
}

/** 校验文件是否已经存在 */
app.get("/api/check", async (req, res, next) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).send("No filename provided.");
  }

  const filePath = path.resolve(PUBLIC_DIR, filename);
  try {
    // 检查文件是否存在
    const exists = await fs.pathExists(filePath);
    if (exists) {
      return res.json({
        success: true,
        message: "File already exists.",
        exists: true,
      });
    }

    const chunkDir = path.resolve(TEMP_DIR, filename);
    // 检查分片目录是否存在
    const chunkExists = await fs.pathExists(chunkDir);
    let uploadedList = [];
    if (chunkExists) {
      // 读取临时目录里面的所有分片对应的文件
      const chunkFiles = await fs.readdir(chunkDir);
      // 读取每个分片文件的文件信息, 主要是它的文件大小, 表示已经上传了多少分片
      uploadedList = await Promise.all(
        chunkFiles.map(async (chunkFile) => {
          const chunkFilePath = path.resolve(chunkDir, chunkFile);
          const stats = await fs.stat(chunkFilePath);
          return {
            chunkFileName: chunkFile,
            size: stats.size,
          };
        })
      );
    }

    return res.json({
      success: true,
      message: "File does not exist.",
      exists: false,
      uploadedList, // 返回已上传的分片列表
    });
  } catch (error) {
    console.error("🚀 ~ app.get ~ error:", error);
    next(error);
  }
});

// 处理文件上传
app.post("/api/upload", async (req, res, next) => {
  // 通过 params 获取文件名
  const { filename, chunkFileName } = req.query;
  if (!filename) {
    return res.status(400).send("No filename provided.");
  }

  // 创建用户保存此文件的分片目录
  const chunkDir = path.resolve(TEMP_DIR, filename);
  // 分片的文件名路径
  const chunkFilePath = path.resolve(chunkDir, chunkFileName);
  // 确保分片目录存在
  await fs.ensureDir(chunkDir);

  // 创建慢速 Transform 流
  const slowTransform = new SlowTransform();

  // 创建一个可写流
  const ws = fs.createWriteStream(chunkFilePath, {
    flags: "a", // 追加模式
    encoding: "binary", // 二进制编码
  });
  // 后面会实现暂停操作, 如果客户端点击率暂停按钮, 会取消上传的操作
  req.on("aborted", () => {
    ws.close();
  });

  try {
    // 使用管道将请求数据流写入文件
    // await pipStream(req, ws);
    // 用慢速 Transform 流节流
    await pipStream(req.pipe(slowTransform), ws);
    res.json({
      success: true,
      message: "File uploaded successfully.",
      filename: filename,
    });
  } catch (error) {
    console.error("🚀 ~ app.post ~ error:", error);
    next(error);
  }
});

// 处理文件合并
app.get("/api/merge", async (req, res, next) => {
  const { filename } = req.query;
  try {
    await mergeChunks(filename);
    res.json({
      success: true,
      message: "File merge request received.",
      filename: filename,
    });
  } catch (error) {
    console.error("🚀 ~ app.get ~ error:", error);
    next(error);
  }
});

function pipStream(rs, ws) {
  return new Promise((resolve, reject) => {
    // 把可读流 rs 的数据通过管道传输到可写流 ws
    // 如果 rs 是一个文件流, 那么可以直接使用 fs.createReadStream
    rs.pipe(ws); // 数据管道传输
    ws.on("finish", resolve); // 写入完成
    ws.on("error", reject); // 写入出错
    rs.on("error", reject); // 读取出错
  });
}

async function mergeChunks(filename) {
  const chunkDir = path.resolve(TEMP_DIR, filename);
  const chunkFiles = await fs.readdir(chunkDir);
  // 确保分片文件名按照数字顺序排序
  chunkFiles.sort((a, b) => {
    const numA = parseInt(a.split(".part")[1], 10);
    const numB = parseInt(b.split(".part")[1], 10);
    return numA - numB;
  });
  // 合并后的路径
  const mergedFilePath = path.resolve(PUBLIC_DIR, filename);
  await fs.ensureDir(PUBLIC_DIR);

  // 为了提高性能, 这里可以实现并行写入
  try {
    await Promise.all(
      chunkFiles.map((chunkFile, index) => {
        const chunkFilePath = path.resolve(chunkDir, chunkFile);
        const rs = fs.createReadStream(chunkFilePath, { autoClose: true });

        // 每个分片的写入流, 从对应的分片位置开始写入
        const ws = fs.createWriteStream(mergedFilePath, {
          start: index * CHUNK_SIZE,
        });

        return pipStream(rs, ws);
      })
    );

    // 合并完成后, 删除分片目录
    await fs.rmdir(chunkDir, { recursive: true }); // 删除分片目录
  } catch (error) {
    console.error("🚀 ~ mergeChunks ~ error:", error);
    throw error;
  }
}

// 应用启动
app.listen(8000, () => {
  console.log("Server is running on http://localhost:8000");
});
