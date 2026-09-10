import { expect } from '@wdio/globals'

const welcomeTitle = '建立你的长期 Agent Team'
const demoAgent = '知衡'

async function assertFreshFirstPage(session: WebdriverIO.Browser) {
  await session.execute(() => localStorage.removeItem('bandi-ui-preferences-v1'))
  await session.refresh()
  await expect(session.$(`h1=${welcomeTitle}`)).toBeDisplayed()
  await expect(session.$('button=创建产品研发团队')).toBeDisplayed()
  await expect(session.$('button[aria-label="切换 Team，当前为个人 Team"]')).toBeDisplayed()
  await expect(session.$(`*=${demoAgent}`)).not.toExist()
}

describe('Desktop fresh hydration', () => {
  it('以全新隔离 HOME 启动真实 binary 后保持无 demo 的首次页', async () => {
    await assertFreshFirstPage(browser)
  })
})
