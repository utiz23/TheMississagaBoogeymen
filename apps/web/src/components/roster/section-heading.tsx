interface Props {
  title: string
  subtitle: string
}

export function SectionHeading({ title, subtitle }: Props) {
  return (
    <div className="border-l-2 border-l-accent pl-3">
      <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-300">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
    </div>
  )
}
