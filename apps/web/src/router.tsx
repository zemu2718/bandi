import { createHashRouter, Navigate } from 'react-router-dom'
import { Shell } from './shell'
import { HomePage } from './pages/home-page'
import { AgentsPage } from './pages/agents/agents-page'
import { AgentCreatePage } from './pages/agents/agent-create-page'
import { AgentDetailPage } from './pages/agents/agent-detail-page'
import { OrganizationPage, TeamDetailPage } from './pages/organization/organization-pages'
import { TaskBriefsPage } from './pages/tasks/task-briefs-page'
import { AssetDetailPage, AssetsPage } from './pages/assets/asset-pages'
import { SkillsPage } from './pages/assets/skills-page'
import { SettingsPage } from './pages/settings/settings-pages'
import { ToolsPage } from './pages/tools/tools-page'
import { GuidePage } from './pages/guide-page'
import { NotFoundPage } from './pages/not-found-page'
import { RouteErrorPage } from './pages/route-error-page'

export const router = createHashRouter([{
  path: '/',
  element: <Shell />,
  errorElement: <RouteErrorPage />,
  children: [
    { index: true, element: <HomePage /> },
    { path: 'agents', element: <AgentsPage /> },
    { path: 'agents/new', element: <AgentCreatePage /> },
    { path: 'agents/:id', element: <AgentDetailPage /> },
    { path: 'organization', element: <OrganizationPage /> },
    { path: 'organization/teams/:id', element: <TeamDetailPage /> },
    { path: 'tasks', element: <TaskBriefsPage /> },
    { path: 'assets', element: <AssetsPage /> },
    { path: 'assets/skills', element: <SkillsPage /> },
    { path: 'assets/:id', element: <AssetDetailPage /> },
    { path: 'tools', element: <ToolsPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'settings/backup', element: <Navigate to="/settings?section=recovery" replace /> },
    { path: 'guide', element: <GuidePage /> },
    { path: '*', element: <NotFoundPage /> },
  ],
}])
