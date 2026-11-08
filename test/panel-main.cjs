const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const origin = process.env.PANEL_TEST_ORIGIN
const output = path.join(__dirname, 'output')
fs.mkdirSync(output, { recursive: true })

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(pathname) {
  const response = await fetch(`${origin}${pathname}`)
  return await response.json()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 440,
    height: 760,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: false },
  })
  await win.loadURL(`${origin}/quick-panel/panel?token=test-token`)
  await delay(1600)

  const layout = await win.webContents.executeJavaScript(`({
    clockFont: getComputedStyle(document.getElementById('clock')).fontSize,
    clockY: document.getElementById('clock').getBoundingClientRect().y,
    balanceFont: getComputedStyle(document.getElementById('usage-balance')).fontSize,
    balanceY: document.getElementById('usage-balance').getBoundingClientRect().y,
    balanceText: document.getElementById('usage-balance').textContent,
    dateFont: getComputedStyle(document.getElementById('date')).fontSize,
    metricsFont: getComputedStyle(document.getElementById('usage-bar')).fontSize,
    dateY: document.getElementById('date').getBoundingClientRect().y,
    metricsY: document.getElementById('usage-bar').getBoundingClientRect().y,
    session: document.getElementById('usage-session').textContent,
    tps: document.getElementById('usage-tps').textContent,
    thirty: document.getElementById('usage-30d').textContent,
    context: document.getElementById('context-value').textContent,
    workingDirectory: document.getElementById('working-dir').textContent,
    workingDirectoryHidden: document.getElementById('working-dir').hidden,
    modelInfo: document.getElementById('model-info').textContent,
    modelInfoHidden: document.getElementById('model-info').hidden,
    approvalVisible: !document.getElementById('approval-card').hidden,
    lockChecked: document.getElementById('approval-lock').checked,
    lockHint: document.getElementById('approval-lock-hint').textContent,
    notifyCount: document.getElementById('notify-count').textContent,
    notifyLatest: document.getElementById('notify-latest').textContent,
    inputDisabled: document.getElementById('quick-input').disabled,
    imageCount: document.querySelectorAll('.feed-image img').length,
    imageWidth: document.querySelector('.feed-image img')?.naturalWidth ?? 0,
    todoIndices: [...document.querySelectorAll('.todo-index')].map((node) => node.textContent),
    reminderIndices: [...document.querySelectorAll('.reminder-index')].map((node) => node.textContent),
    todoCheck: (() => {
      const box = document.querySelector('.todo .check');
      const style = getComputedStyle(box);
      return {
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        background: style.backgroundColor,
      };
    })(),
  })`)
  assert.equal(layout.clockFont, '30px')
  assert.equal(layout.balanceFont, '30px')
  assert.equal(Math.round(layout.clockY), Math.round(layout.balanceY))
  assert.equal(layout.balanceText, '¥12.34')
  assert.equal(layout.dateFont, '11px')
  assert.equal(layout.metricsFont, '11px')
  assert.equal(Math.round(layout.dateY), Math.round(layout.metricsY))
  assert.equal(layout.session, '88.70M')
  assert.equal(layout.tps, '45 tok/s')
  assert.equal(layout.thirty, '1.20G')
  assert.equal(layout.context, '34%')
  assert.equal(layout.workingDirectory, 'D:\\Projects\\demo')
  assert.equal(layout.workingDirectoryHidden, false)
  assert.equal(layout.modelInfo, 'deepseek-flash · 高')
  assert.equal(layout.modelInfoHidden, false)
  assert.equal(layout.approvalVisible, true)
  assert.equal(layout.lockChecked, false)
  assert.match(layout.lockHint, /勾选后/)
  assert.equal(layout.notifyCount, '1')
  assert.match(layout.notifyLatest, /审批请求/)
  assert.equal(layout.inputDisabled, true)
  assert.equal(layout.imageCount, 1)
  assert.ok(layout.imageWidth > 0, 'thumbnail should load')
  assert.deepEqual(layout.todoIndices, ['1.', '2.'])
  assert.deepEqual(layout.reminderIndices, ['1.', '2.'])
  assert.ok(Number.parseFloat(layout.todoCheck.borderWidth) >= 1, layout.todoCheck.borderWidth)
  assert.notEqual(layout.todoCheck.borderColor, 'rgba(0, 0, 0, 0)')
  assert.notEqual(layout.todoCheck.background, 'rgba(0, 0, 0, 0)')

  await win.webContents.executeJavaScript(`document.getElementById('approval-lock').click()`)
  await delay(900)
  const lockRequests = await fetchJson('/test/lock')
  assert.equal(lockRequests.length, 1)
  assert.equal(lockRequests[0], true)
  const lockedUi = await win.webContents.executeJavaScript(`({
    checked: document.getElementById('approval-lock').checked,
    hint: document.getElementById('approval-lock-hint').textContent,
  })`)
  assert.equal(lockedUi.checked, true)
  assert.match(lockedUi.hint, /已锁定/)

  await win.webContents.executeJavaScript(`document.getElementById('notify-toggle').click()`)
  await delay(250)
  const notifyUi = await win.webContents.executeJavaScript(`({
    open: !document.getElementById('notify-list').hidden,
    rows: document.querySelectorAll('.notify-row').length,
    count: document.getElementById('notify-count').textContent,
    unread: document.querySelectorAll('.notify-row.is-unread').length,
  })`)
  assert.equal(notifyUi.open, true)
  assert.ok(notifyUi.rows >= 1)
  assert.equal(notifyUi.count, '0')
  assert.equal(notifyUi.unread, 0)
  await win.webContents.executeJavaScript(`document.getElementById('notify-toggle').click()`)

  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  )
  await delay(800)
  let answers = await fetchJson('/test/answers')
  assert.equal(answers.length, 1)
  assert.equal(answers[0].outcome, 'allow')
  await delay(1500)
  let after = await win.webContents.executeJavaScript(`({
    approvalVisible: !document.getElementById('approval-card').hidden,
    inputDisabled: document.getElementById('quick-input').disabled,
  })`)
  assert.equal(after.approvalVisible, false)
  assert.equal(after.inputDisabled, false)

  const dropped = await win.webContents.executeJavaScript(`
    (async () => {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const file = new File([bytes], 'drop.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        chips: document.querySelectorAll('.attachment-chip').length,
        name: document.querySelector('.attachment-name')?.textContent ?? '',
        sendDisabled: document.getElementById('quick-send').disabled,
      };
    })()
  `)
  assert.equal(dropped.chips, 1)
  assert.equal(dropped.name, 'drop.png')
  assert.equal(dropped.sendDisabled, false)

  await win.webContents.executeJavaScript(`document.getElementById('quick-send').click()`)
  await delay(700)
  const sentUploads = await fetchJson('/test/uploads')
  assert.equal(sentUploads.length, 1)
  assert.equal(sentUploads[0].mediaType, 'image/png')
  const sentPrompts = await fetchJson('/test/prompts')
  assert.equal(sentPrompts.length, 1)
  assert.equal(sentPrompts[0].attachments.length, 1)
  assert.equal(sentPrompts[0].attachments[0].receiptId, 'receipt-1')
  assert.equal(sentPrompts[0].attachments[0].kind, 'image')
  const afterSend = await win.webContents.executeJavaScript(`({
    chips: document.querySelectorAll('.attachment-chip').length,
  })`)
  assert.equal(afterSend.chips, 0)

  await win.webContents.executeJavaScript(`
    window.__qpNotifications = [];
    window.Notification = function (title, options) {
      window.__qpNotifications.push({ title, options: options || {} });
      this.close = function () {};
    };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
    true;
  `)
  await fetchJson('/test/approval')
  await delay(1600)
  const notices = await win.webContents.executeJavaScript('window.__qpNotifications')
  assert.equal(notices.length, 1)
  assert.match(notices[0].title, /权限请求/)
  assert.match(notices[0].options.body, /需要管理员权限/)
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await delay(800)
  answers = await fetchJson('/test/answers')
  assert.equal(answers.length, 2)
  assert.equal(answers[1].outcome, 'reject')

  await win.webContents.executeJavaScript(`document.querySelector('.feed-image').click()`)
  await delay(500)
  const viewer = await win.webContents.executeJavaScript(`({
    open: !document.getElementById('image-viewer').hidden,
    src: document.getElementById('image-viewer-img').getAttribute('src'),
  })`)
  assert.equal(viewer.open, true)
  assert.match(viewer.src, /\/quick-panel\/attachment\?id=img1/)
  await win.webContents.executeJavaScript(`document.getElementById('image-viewer-close').click()`)
  await delay(250)

  await fetchJson('/test/question')
  await delay(1600)
  const questionUi = await win.webContents.executeJavaScript(`({
    visible: !document.getElementById('question-card').hidden,
    title: document.getElementById('question-title').textContent,
    optionCount: document.querySelectorAll('.question-option').length,
    composerDisabled: document.getElementById('quick-input').disabled,
  })`)
  assert.equal(questionUi.visible, true)
  assert.equal(questionUi.title, '请选择一个测试选项')
  assert.equal(questionUi.optionCount, 2)
  assert.equal(questionUi.composerDisabled, true)
  await win.webContents.executeJavaScript(`document.querySelector('.question-option').click()`)
  await delay(150)
  await win.webContents.executeJavaScript(`document.getElementById('question-submit').click()`)
  await delay(900)
  const questionAnswers = await fetchJson('/test/question-answers')
  assert.equal(questionAnswers.length, 1)
  assert.equal(questionAnswers[0].answers[0].id, 'q1')
  assert.deepEqual(questionAnswers[0].answers[0].selected, ['选项 A'])

  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(output, 'panel.png'), image.toPNG())
  console.log('PANEL DOM CHECKS PASSED')
  win.destroy()
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
