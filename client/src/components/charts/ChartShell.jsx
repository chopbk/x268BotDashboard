import { useId, useState } from "react";

/**
 * Khung chart chung: tiêu đề câu hỏi, kỳ/đơn vị/UTC, tóm tắt code, trạng thái, xem dữ liệu.
 */
export default function ChartShell({
  title,
  subtitle,
  summary,
  loading = false,
  error = "",
  empty = "",
  refreshing = false,
  actions = null,
  dataRows = null,
  dataColumns = null,
  children,
  className = "",
  height = "normal",
}) {
  const tableId = useId();
  const [showData, setShowData] = useState(false);
  const hasDataTable = Array.isArray(dataRows) && Array.isArray(dataColumns) && dataColumns.length > 0;

  if (loading) {
    return (
      <section className={`dv-shell card skeleton-block skeleton-chart ${className}`} aria-busy="true" aria-label={title || "Đang tải biểu đồ"}>
        <span className="sr-only">Đang tải biểu đồ</span>
      </section>
    );
  }

  return (
    <section className={`dv-shell card height-${height} ${className}`}>
      <header className="dv-shell-head">
        <div className="dv-shell-titles">
          {title ? <h2>{title}</h2> : null}
          {subtitle ? <p className="muted dv-shell-sub">{subtitle}</p> : null}
          {summary ? <p className="dv-shell-summary">{summary}</p> : null}
          {refreshing ? <p className="muted">Đang cập nhật…</p> : null}
        </div>
        <div className="dv-shell-actions">
          {actions}
          {hasDataTable ? (
            <button
              type="button"
              className="ghost"
              aria-expanded={showData}
              aria-controls={tableId}
              onClick={() => setShowData((open) => !open)}
            >
              {showData ? "Ẩn dữ liệu" : "Xem dữ liệu"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="dv-state error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {!error && empty ? (
        <div className="dv-state empty">
          <p className="muted">{empty}</p>
        </div>
      ) : null}

      {!error && !empty ? <div className="dv-shell-body">{children}</div> : null}

      {showData && hasDataTable ? (
        <div className="dv-data table-wrap" id={tableId}>
          <table>
            <thead>
              <tr>
                {dataColumns.map((col) => (
                  <th key={col.key} className={col.num ? "num" : undefined}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.length === 0 ? (
                <tr><td colSpan={dataColumns.length}>Không có dòng.</td></tr>
              ) : dataRows.map((row, index) => (
                <tr key={row.id || row.key || index}>
                  {dataColumns.map((col) => (
                    <td key={col.key} className={col.num ? `num ${col.tone?.(row) || ""}` : undefined}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
