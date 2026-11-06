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
    approvalVisible: !document.getElementById('approval-card').hidden,
    inputDisabled: document.getElementById('quick-input').disabled,
    imageCount: document.querySelectorAll('.feed-image img').length,
    imageWidth: document.querySelector('.feed-image img')?.naturalWidth ?? 0,
    todoIndices: [...document.querySelectorAll('.todo-index')].map((node) => node.textContent),
    reminderIndices: [...document.querySelectorAll('.reminder-index')].map((node) => node.textContent),
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
  assert.equal(layout.approvalVisible, true)
  assert.equal(layout.inputDisabled, true)
  assert.equal(layout.imageCount, 1)
  assert.ok(layout.imageWidth > 0, 'thumbnail should load')
  assert.deepEqual(layout.todoIndices, ['1.', '2.'])
  assert.deepEqual(layout.reminderIndices, ['1.', '2.'])

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

  await fetchJson('/test/approval')
  await delay(1600)
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
