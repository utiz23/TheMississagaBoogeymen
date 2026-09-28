import { LegalPage } from '@/components/legal/legal-page'
import { legalMetadata } from '@/lib/legal/legal-docs'
import { intro, sections } from '@/content/legal/privacy'

export const metadata = legalMetadata('privacy')

export const revalidate = 86400

export default function PrivacyPolicyPage() {
  return <LegalPage slug="privacy" intro={intro} sections={sections} />
}
