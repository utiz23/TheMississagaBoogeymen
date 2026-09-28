import { LegalPage } from '@/components/legal/legal-page'
import { legalMetadata } from '@/lib/legal/legal-docs'
import { intro, sections } from '@/content/legal/data-collection'

export const metadata = legalMetadata('data-collection')

export const revalidate = 86400

export default function DataCollectionPolicyPage() {
  return <LegalPage slug="data-collection" intro={intro} sections={sections} />
}
