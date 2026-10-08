/**
 * Placeholder row for a strip whose channel is not on this level (UX guideline 4: layouts persist
 * globally, so an absent channel collapses to `oil_temp: not on this car` rather than vanishing).
 * It keeps the gutter behaviour (drag, keyboard, remove) and never instantiates uPlot.
 */
import { StripGutter, type StripGutterProps } from './StripGutter';

export type StripPlaceholderProps = Omit<
  StripGutterProps,
  'placeholder' | 'slot' | 'unit' | 'label'
>;

export function StripPlaceholder(props: StripPlaceholderProps) {
  return (
    <StripGutter
      {...props}
      label={`${props.id}: not on this car`}
      unit=""
      slot={null}
      placeholder
    />
  );
}
