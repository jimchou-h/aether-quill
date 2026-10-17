#!/usr/bin/env node
/**
 * 跨平台测试入口（W5）。
 *
 * 背景：Node 20 的 `node --test` 不支持 glob 参数——在 Windows 下
 * `node --import tsx --test 'src/**\/*.test.ts'` 会把带引号的模式当成**字面路径**，
 * 直接报 `Could not find '...src\**\*.test.ts'`。Node 21+ 才支持 glob，但本仓库支持的
 * 运行时含 Node 20，因此这里不依赖 shell/Node 的 glob：
 *
 *   1. 在当前包目录下递归显式收集 `src/**\/*.test.ts(x)`；
 *   2. 以文件列表调用 `node --import tsx --test <files...>`。
 *
 * 这样在 Node 20 / 22、Windows / POSIX 下行为一致，也不再需要 `--test-force-exit` 之类的临时兜底。
 *
 * 用法：在包的 test 脚本里写 `node ../../scripts/run-tests.mjs`；
 * 透传参数会原样追加到 `node --test` 之后（例如 `--test-force-exit`）。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const passthrough = process.argv.slice(2);

function collect(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }
      collect(full, acc);
    } else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collect(join(cwd, 'src'), []).sort();
if (files.length === 0) {
  console.error(`[run-tests] 在 ${join(cwd, 'src')} 下未找到任何 *.test.ts 文件`);
  process.exit(1);
}

const nodeArgs = ['--import', 'tsx', '--test', ...passthrough, ...files];
const result = spawnSync(process.execPath, nodeArgs, { cwd, stdio: 'inherit' });
if (result.error) {
  console.error('[run-tests] 无法启动测试进程：', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
