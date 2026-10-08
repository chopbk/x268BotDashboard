import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const GuardContext = createContext(null);

export function GuardProvider({ children }) {
  const navigate = useNavigate();
  const whenRef = useRef(false);
  const messageRef = useRef("");
  const bypass = useRef(false);
  const [ask, setAsk] = useState(null);

  function setGuard(when, message) {
    whenRef.current = when;
    messageRef.current = message || "";
  }

  function confirmLeave() {
    if (!whenRef.current || bypass.current) return Promise.resolve(true);
    return new Promise((resolve) => {
      setAsk({ resolve, message: messageRef.current });
    });
  }

  useEffect(() => {
    function onClick(event) {
      if (!whenRef.current || bypass.current || ask) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next === current) return;
      event.preventDefault();
      event.stopPropagation();
      setAsk({ href: next, message: messageRef.current });
    }
    function onPop() {
      if (!whenRef.current || bypass.current) return;
      bypass.current = true;
      history.go(1);
      window.setTimeout(() => {
        bypass.current = false;
      }, 80);
      setAsk({ back: true, message: messageRef.current });
    }
    function onBeforeUnload(event) {
      if (!whenRef.current || bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [ask, navigate]);

  function stay() {
    ask?.resolve?.(false);
    setAsk(null);
  }

  function discard() {
    const pending = ask;
    bypass.current = true;
    whenRef.current = false;
    pending?.resolve?.(true);
    setAsk(null);
    if (pending?.back) history.back();
    else if (pending?.href) navigate(pending.href);
    window.setTimeout(() => {
      bypass.current = false;
    }, 80);
  }

  return (
    <GuardContext.Provider value={{ setGuard, confirmLeave }}>
      {children}
      {ask ? (
        <div className="modal-backdrop">
          <div className="modal-card leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title">
            <h2 id="leave-title">Có thay đổi chưa lưu</h2>
            <p>{ask.message || "Rời trang sẽ bỏ phần đang sửa."}</p>
            <div className="row-actions">
              <button type="button" onClick={stay}>Ở lại</button>
              <button type="button" className="danger" onClick={discard}>Bỏ thay đổi</button>
            </div>
          </div>
        </div>
      ) : null}
    </GuardContext.Provider>
  );
}

export function useLeaveGuard(when, message = "") {
  const guard = useContext(GuardContext);
  useEffect(() => {
    if (!guard) return undefined;
    guard.setGuard(Boolean(when), message);
    return () => guard.setGuard(false, "");
  }, [guard, when, message]);
  return guard;
}

export function Crumbs({ items, returnTo }) {
  const parent = [...items].reverse().find((item) => item.to);
  const showReturn = returnTo && returnTo !== parent?.to;
  return (
    <div className="crumb-row">
      <nav className="crumbs" aria-label="Đường dẫn">
        {items.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            {index > 0 ? <span aria-hidden="true"> / </span> : null}
            {item.to ? <Link to={item.to} state={item.state}>{item.label}</Link> : <span>{item.label}</span>}
          </span>
        ))}
      </nav>
      {showReturn ? <Link to={returnTo}>Quay lại kết quả</Link> : null}
    </div>
  );
}

export function useEscape(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
