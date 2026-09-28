import { LegalPage } from '@/components/legal/legal-page'
import { legalMetadata } from '@/lib/legal/legal-docs'
import { intro, sections } from '@/content/legal/attribution'

export const metadata = legalMetadata('attribution')

export const revalidate = 86400

export default function AttributionNoticePage() {
  return <LegalPage slug="attribution" intro={intro} sections={sections} />
}
