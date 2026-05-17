type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  matchIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  disabled?: boolean;
  placeholder: string;
  prevLabel: string;
  nextLabel: string;
  countLabel: string;
  noResultsLabel: string;
};

export default function PanelRecordSearch(props: Props) {
  const {
    query,
    onQueryChange,
    matchCount,
    matchIndex,
    onPrev,
    onNext,
    onClear,
    disabled,
    placeholder,
    prevLabel,
    nextLabel,
    countLabel,
    noResultsLabel,
  } = props;

  const countText =
    matchCount === 0
      ? query.trim()
        ? noResultsLabel
        : ""
      : countLabel.replace("{current}", String(matchIndex + 1)).replace("{total}", String(matchCount));

  return (
    <div className="panel-search" aria-label="Record search">
      <input
        className="panel-search__input"
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onNext();
          } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            onPrev();
          }
        }}
      />
      <span className="panel-search__count">{countText}</span>
      <button type="button" className="btn btn--sm" onClick={onPrev} disabled={disabled || matchCount === 0}>
        {prevLabel}
      </button>
      <button type="button" className="btn btn--sm" onClick={onNext} disabled={disabled || matchCount === 0}>
        {nextLabel}
      </button>
      {query ? (
        <button type="button" className="btn btn--sm" onClick={onClear} disabled={disabled}>
          ×
        </button>
      ) : null}
    </div>
  );
}
