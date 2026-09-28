import { LegalPage } from '@/components/legal/legal-page'
import { legalMetadata } from '@/lib/legal/legal-docs'
import { intro, sections } from '@/content/legal/terms'

export const metadata = legalMetadata('terms')

export const revalidate = 86400

export default function TermsOfUsePage() {
  return <LegalPage slug="terms" intro={intro} sections={sections} />
}
