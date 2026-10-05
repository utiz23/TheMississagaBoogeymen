import Link from 'next/link'
import { RouteStatus, routeStatusLinkClass } from '@/components/ui/route-status'

export default function NotFound() {
  return (
    <RouteStatus
      code="404"
      title="Page not found"
      message="That page doesn't exist, or it has moved."
    >
      <Link href="/" className={routeStatusLinkClass}>
        Back to home
      </Link>
    </RouteStatus>
  )
}
