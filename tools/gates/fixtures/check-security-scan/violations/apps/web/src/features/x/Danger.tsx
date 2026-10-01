export function Danger({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />; // EXPECT[security/dangerously-set-inner-html]
}
