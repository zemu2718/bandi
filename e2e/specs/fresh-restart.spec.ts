import { expect } from '@wdio/globals'

const welcomeTitle = '先新建或导入一个长期 Agent'
const demoAgent = '知衡'

async function assertFreshFirstPage(session: WebdriverIO.Browser) {
  await expect(session.$(`h1=${welcomeTitle}`)).toBeDisplayed()
  await expect(session.$(`*=${demoAgent}`)).not.toExist()
}

describe('Desktop fresh hydration', () => {
  it('以全新隔离 HOME 启动真实 binary 后保持无 demo 的首次页', async () => {
    await assertFreshFirstPage(browser)
  })
})
