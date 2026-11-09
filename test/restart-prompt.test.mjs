/**
 * The first-run restart notice is the only guard against users reading
 * "Host offline" as "the plugin is broken". Keep the Windows quit wording and
 * the "refresh is not enough" warning in both dictionaries.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { en, zh } from '../src/client/locales.js'

for (const [name, dictionary] of [
  ['zh', zh],
  ['en', en],
]) {
  test(`${name} restart prompt explains the Windows quit and the full restart`, () => {
    assert.match(dictionary.restartTitle, name === 'zh' ? /重启 DSH/ : /restart DSH/i)
    assert.match(dictionary.restartShortcut, name === 'zh' ? /托盘|任务管理器/ : /tray|task manager/i)
    assert.match(dictionary.restartBody, name === 'zh' ? /Host 未连接/ : /Host offline/i)
    assert.match(dictionary.restartBody, name === 'zh' ? /刷新/ : /refresh/i)
    assert.match(dictionary.restartAfter, name === 'zh' ? /不会重新下载/ : /will not download again/i)
    assert.match(dictionary.windowFailedHost, name === 'zh' ? /完全退出/ : /quit DSH completely/i)
  })
}
