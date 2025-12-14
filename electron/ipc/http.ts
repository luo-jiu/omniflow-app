import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function registerHttpIpc(ipcMain: Electron.IpcMain) {
  ipcMain.handle("http:fetch", async (_event, url: string, options: any = {}) => {
    console.log("start...");
    console.log("URL:", url);
    console.log("Options:", options);
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method: options.method || "GET" });

      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          console.log(`set head... ${key}: ${value}`);
          request.setHeader(key, value as string);
        });
      }
      let body = "";
      request.on("response", (response) => {
        console.log("return info...");
        console.log("Status:", response.statusCode);
        console.log("Headers:", response.headers);

        response.on("data", (chunk) => {
          console.log(`data len... ${chunk.length})`);
          body += chunk;
        });
        response.on("end", () => {
          console.log("Body info... ", body.slice(0, 500)); // 只打印前 500 字符
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = body;
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: parsedBody,
          });
        });
      });
      request.on("error", (err) => {
        console.error("err... ", err);
        reject(err);
      });
      if (options.body) {
        request.write(options.body);
      }
      request.end();
    });
  });

  ipcMain.handle("http:upload", async (_event, url: string, filePath: string, formDataParams: Record<string, string> = {}, headers: Record<string, string> = {}) => {
    return new Promise((resolve, reject) => {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const request = net.request({
        url,
        method: 'POST',
      });
      
      // Merge headers
      const finalHeaders = {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      };

      Object.entries(finalHeaders).forEach(([key, value]) => {
        request.setHeader(key, value);
      });

      let responseBody = "";

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
           let parsedBody: any;
          try {
            parsedBody = JSON.parse(responseBody);
          } catch {
            parsedBody = responseBody;
          }
          resolve({
            status: response.statusCode,
            body: parsedBody
          });
        });
      });
      
      request.on('error', (err) => reject(err));

      const writePart = (name: string, value: string) => {
        request.write(`--${boundary}\r\n`);
        request.write(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
        request.write(`${value}\r\n`);
      };

      // Write regular fields
      Object.entries(formDataParams).forEach(([key, value]) => {
        writePart(key, value);
      });

      // Write file
      const fileName = path.basename(filePath);
      request.write(`--${boundary}\r\n`);
      request.write(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`);
      request.write(`Content-Type: application/octet-stream\r\n\r\n`);

      const fileStream = fs.createReadStream(filePath);
      fileStream.on('data', (chunk) => {
        request.write(chunk);
      });
      
      fileStream.on('end', () => {
        request.write(`\r\n--${boundary}--\r\n`);
        request.end();
      });

      fileStream.on('error', (err) => {
        reject(err);
        request.abort();
      });
    });
  });
}
