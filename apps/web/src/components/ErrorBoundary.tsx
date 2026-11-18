import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import i18n from "../i18n";

type Props = { children: ReactNode; fallbackHome?: string };
type State = { hasError: boolean };

const CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\d]+ failed/i;
const CHUNK_FLAG = "pa-chunk-reload";

/**
 * Evita páxina en branco cando un render falla (ex. A1 facilityLat número).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    if (CHUNK_RE.test(`${error.name} ${error.message}`)) {
      try {
        if (sessionStorage.getItem(CHUNK_FLAG) !== "1") {
          sessionStorage.setItem(CHUNK_FLAG, "1");
          window.location.reload();
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const home = this.props.fallbackHome ?? "/";
    const t = i18n.t.bind(i18n);
    return (
      <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <h1 className="m-0 text-[26px] font-extrabold text-marino">
          {t("common.somethingFailed")}
        </h1>
        <p className="m-0 text-[15px] text-graphite">
          {t("common.unexpectedError", {
            defaultValue:
              "Produciuse un erro inesperado. Podes volver ao inicio e tentalo de novo.",
          })}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <button type="button" className="pa-btn-secondary" onClick={this.reset}>
            {t("common.tryAgain", { defaultValue: "Tentar de novo" })}
          </button>
          <Link to={home} className="pa-btn-primary" onClick={this.reset}>
            {t("common.backHome", { defaultValue: "Volver ao inicio" })}
          </Link>
        </div>
      </main>
    );
  }
}
