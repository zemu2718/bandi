import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'

export function NotFoundPage() {
  return <div className="panel mx-auto max-w-2xl p-10 text-center"><h1 className="text-2xl font-semibold">页面不存在</h1><p className="mt-3 text-sm text-muted-foreground">请检查链接是否正确，或返回配置状态。</p><Button className="mt-6" asChild><Link to="/">返回配置状态</Link></Button></div>
}
