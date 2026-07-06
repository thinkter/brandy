export type RenderResult = JSX.Element | string | Promise<JSX.Element | string>;
export type Params = Record<string, string>;

export interface RequestContext {
  params: Params;
  request: Request;
  url: URL;
}

export interface ErrorContext extends RequestContext {
  error: unknown;
  dev: boolean;
}

export interface RenderOptions {
  dev?: boolean;
  metadataMode?: "replace" | "merge";
}

export interface RenderContext<T = unknown> extends RequestContext {
  data: T;
}

export interface LayoutRenderContext<T = unknown> extends RenderContext<T> {
  children: JSX.Element;
}

export type Loader<T = unknown> = (context: RequestContext) => T | Promise<T>;
export type MetadataValue = string | Record<string, string>;

export interface Metadata {
  title?: string;
  meta?: Record<string, MetadataValue>;
}

export type MetadataExport<T = unknown> = Metadata | ((context: RenderContext<T>) => Metadata | Promise<Metadata>);
export type ErrorRenderer = (props: ErrorContext) => RenderResult;
export type NotFoundRenderer = (props: RequestContext) => RenderResult;

export interface SegmentModule<T = unknown> {
  load?: Loader<T>;
  metadata?: MetadataExport<T>;
}

export interface PageModule<T = unknown> extends SegmentModule<T> {
  default: (props: RenderContext<T>) => RenderResult;
  /** Cache the rendered output forever, until an action explicitly calls `revalidate()`. Ignored if `revalidate` is also set. */
  prerender?: boolean;
  /** Cache the rendered output for this many seconds; recomputed on the first request after expiry. Implies `prerender`. */
  revalidate?: number;
}

export interface LayoutModule<T = unknown> extends SegmentModule<T> {
  default: (props: LayoutRenderContext<T>) => RenderResult;
}

export type LoadingRenderer = () => RenderResult;

export interface LayoutNode extends SegmentModule {
  id: string;
  directory: string;
  file: string;
  render: LayoutModule["default"];
  renderError?: ErrorRenderer;
  renderNotFound?: NotFoundRenderer;
  renderLoading?: LoadingRenderer;
}

export interface PageCache {
  /** null = cache forever until an action explicitly revalidates it; a number = TTL in seconds. */
  revalidateSeconds: number | null;
}

export interface PageNode extends SegmentModule {
  id: string;
  directory: string;
  file: string;
  render: PageModule["default"];
  renderError?: ErrorRenderer;
  renderNotFound?: NotFoundRenderer;
  renderLoading?: LoadingRenderer;
  cache?: PageCache;
}

export type ActionResult = Revalidation | void | Response;
export type ActionHandler = (form: FormData, context: RequestContext) => ActionResult | Promise<ActionResult>;
/** Callable on the server and string-compatible when rendered as a form action. */
export type ServerAction = ActionHandler & string;

export interface ActionDefinition {
  id: string;
  path: string;
  segmentPath: string;
  file: string;
  name: string;
  handler: ServerAction;
}

export interface Revalidation {
  readonly kind: "brandy-revalidate";
  readonly path: string;
}

/** An alternate rendering of a standalone route, declared by a (.)/(..)/(...) marker
 * directory. Rendered naked (no layouts) into the reserved modal outlet when the
 * current route's segments exactly match fromSegments. */
export interface InterceptedRoute {
  fromSegments: string[];
  page: PageNode;
}

export interface Route {
  id: string;
  pattern: string;
  segments: string[];
  layouts: LayoutNode[];
  page: PageNode;
  /** @deprecated Use page.file. */
  pageFile: string;
  /** @deprecated Use page.render. */
  renderPage: PageModule["default"];
  interceptedBy?: InterceptedRoute[];
}

export interface RouteManifest {
  appDir: string;
  routes: Route[];
  actions: Map<string, ActionDefinition>;
  rootNotFound?: NotFoundRenderer;
  /** The route used for unmatched URLs, initialized once when the server starts. */
  notFoundRoute?: Route;
}

export interface RouteMatch {
  route: Route;
  pathname: string;
  params: Params;
  /** True when this match renders the not-found route for an unmatched pathname. */
  missing?: boolean;
}

export interface RouteDiff {
  current: RouteMatch;
  target: RouteMatch;
  boundary: LayoutNode;
  chainToRender: LayoutNode[];
}

export interface LoadedRoute {
  match: RouteMatch;
  data: Map<string, unknown>;
  metadata: Metadata;
}

export interface SyncRenderedRoute {
  kind: "sync";
  html: string;
  metadata: Metadata;
  status: number;
}

export interface StreamRenderedRoute {
  kind: "stream";
  stream: ReadableStream<Uint8Array>;
  status: 200;
}

export type RenderedRoute = SyncRenderedRoute | StreamRenderedRoute;
