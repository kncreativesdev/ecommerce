const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = "34567";
const root = path.join(__dirname, "..");

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  env: { ...process.env, PORT },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  stdout += String(chunk);
});

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

function waitForListen(timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const timer = setInterval(() => {
      if (stdout.includes("Server listening on port")) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Server exited early: ${child.exitCode}\n${stderr}`));
        return;
      }

      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for listen\n${stdout}\n${stderr}`));
      }
    }, 100);
  });
}

function requestJson(pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${PORT}${pathname}`, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: raw });
        });
      })
      .on("error", reject);
  });
}

(async () => {
  try {
    await waitForListen(15000);
    console.log("start_ok");

    const { statusCode, body } = await requestJson("/api/v1/health");
    console.log("health_status", statusCode);

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new Error(`Health response is not valid JSON: ${body}`);
    }

    if (statusCode !== 200) {
      throw new Error(`Expected health status 200, received ${statusCode}`);
    }

    if (payload.success !== true || payload.data?.status !== "healthy") {
      throw new Error(`Unexpected health payload: ${body}`);
    }

    console.log("health_ok");

    child.kill("SIGTERM");

    const { code, signal } = await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve({ code: child.exitCode, signal: child.signalCode });
      } else {
        child.on("exit", (exitCode, exitSignal) =>
          resolve({ code: exitCode, signal: exitSignal })
        );
      }
    });

    console.log("shutdown_code", code, "shutdown_signal", signal);

    if (code === 0) {
      console.log("shutdown_ok");
    } else if (process.platform === "win32" && code === null && signal === "SIGTERM") {
      // Windows terminates a child process on SIGTERM forcibly; the signal
      // cannot be caught, so the server's graceful-shutdown handler cannot
      // run here. The exit-0 shutdown path applies on POSIX systems.
      console.log("shutdown_forced_by_os_win32");
    } else {
      throw new Error(`Unexpected shutdown: code=${code} signal=${signal}`);
    }
  } catch (error) {
    child.kill("SIGTERM");
    console.error(error);
    process.exit(1);
  }
})();
