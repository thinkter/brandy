export type RenderResult = JSX.Element | string | Promise<JSX.Element | string>;
export type Params = Record<string, string>;

export interface RequestContext {
  params: Params;
  request: Request;
  url: URL;
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
export type ErrorRenderer = (props: RequestContext & { error: unknown }) => RenderResult;
export type NotFoundRenderer = (props: RequestContext) => RenderResult;

export interface SegmentModule<T = unknown> {
  load?: Loader<T>;
  metadata?: MetadataExport<T>;
}

export interface PageModule<T = unknown> extends SegmentModule<T> {
  default: (props: RenderContext<T>) => RenderResult;
}

export interface LayoutModule<T = unknown> extends SegmentModule<T> {
  default: (props: LayoutRenderContext<T>) => RenderResult;
}

export interface LayoutNode extends SegmentModule {
  id: string;
  directory: string;
  file: string;
  render: LayoutModule["default"];
  renderError?: ErrorRenderer;
  renderNotFound?: NotFoundRenderer;
}

export interface PageNode extends SegmentModule {
  id: string;
  directory: string;
  file: string;
  render: PageModule["default"];
  renderError?: ErrorRenderer;
  renderNotFound?: NotFoundRenderer;
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
}

export interface RouteManifest {
  appDir: string;
  routes: Route[];
  actions: Map<string, ActionDefinition>;
  rootNotFound?: NotFoundRenderer;
}

export interface RouteMatch {
  route: Route;
  pathname: string;
  params: Params;
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

export interface RenderedRoute {
  html: string;
  metadata: Metadata;
  status: number;
}
