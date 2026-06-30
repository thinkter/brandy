import Alpine from "alpinejs";
import "./runtime.ts";

(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();
