import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CopilotApiConfig {
  port?: number;
  simulate?: boolean;
  allowedModels?: string[];
}

// 配置文件位置：根据运行平台选择合适的位置（跨平台）
function getBaseConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  const plat = process.platform;
  if (plat === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (plat === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  // 默认 Linux/其他使用 ~/.config
  return path.join(os.homedir(), '.config');
}

const baseConfigDir = getBaseConfigDir();
export const CONFIG_DIR = path.join(baseConfigDir, 'copilot-api');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

let _cfg: CopilotApiConfig = {
  port: 11435,
  simulate: false,
  allowedModels: [],
};

function ensureDirSync(): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch (e) {
    // 忽略创建目录错误，但记录以便调试
    // console.error(`ensureDirSync failed: ${String(e)}`);
  }
}

/** 异步读取配置文件（存在时） */
function loadConfigSync(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw) as CopilotApiConfig;
      _cfg = Object.assign({}, _cfg, parsed ?? {});
    } else {
      // 不在模块加载阶段创建文件，避免阻塞激活流程
    }
  } catch (e) {
    console.error('[copilot-api] loadConfig failed:', e);
  }
}

/** 原子写入配置：先写入临时文件，再重命名覆盖 */
async function saveConfig(): Promise<void> {
  try {
    ensureDirSync();
    const tmp = CONFIG_PATH + `.tmp.${process.pid}`;
    await fs.promises.writeFile(tmp, JSON.stringify(_cfg, null, 2), { encoding: 'utf8' });
    await fs.promises.rename(tmp, CONFIG_PATH);
  } catch (e) {
    console.error('[copilot-api] saveConfig failed:', e);
  }
}

// 在模块加载时同步尝试读取一次配置（不创建文件）
loadConfigSync();

export function getConfig(): CopilotApiConfig {
  return Object.assign({}, _cfg);
}

export function getPort(): number {
  return Number.isInteger(_cfg.port as number) ? (_cfg.port as number) : 11435;
}

export function getSimulate(): boolean {
  return !!_cfg.simulate;
}

export function getAllowedModels(): string[] {
  return Array.isArray(_cfg.allowedModels) ? (_cfg.allowedModels as string[]).slice() : [];
}

export async function setAllowedModels(models: string[]): Promise<void> {
  _cfg.allowedModels = Array.isArray(models) ? models.slice() : [];
  await saveConfig();
}

export async function setPort(port: number): Promise<void> {
  _cfg.port = port;
  await saveConfig();
}

export async function setSimulate(sim: boolean): Promise<void> {
  _cfg.simulate = !!sim;
  await saveConfig();
}

export async function setConfig(key: keyof CopilotApiConfig, value: unknown): Promise<void> {
  (_cfg as any)[key] = value as any;
  await saveConfig();
}
