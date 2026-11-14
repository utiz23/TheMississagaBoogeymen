import { LegalPage } from '@/components/legal/legal-page'
import { legalMetadata } from '@/lib/legal/legal-docs'
import { intro, sections } from '@/content/legal/privacy'
import { backgroundSection } from './background-section'

export const metadata = legalMetadata('privacy')

export const revalidate = 86400

const all = [...sections, backgroundSection(Math.max(...sections.map((s) => s.number)))]

export default function PrivacyPolicyPage() {
  return <LegalPage slug="privacy" intro={intro} sections={all} />
}
