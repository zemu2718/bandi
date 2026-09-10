import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state'

export function GuidePage() {
  const { dispatch } = useApp()
  const navigate = useNavigate()

  useEffect(() => {
    dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'usage-guide', topic: 'quick-start' } })
    navigate('/', { replace: true })
  }, [dispatch, navigate])

  return null
}
