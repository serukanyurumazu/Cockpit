import { register, svelteModule } from "../core/module";
import Terminal from "./terminal/Terminal.svelte";
import Browser from "./browser/Browser.svelte";

// New features: add a folder under modules/ and register it here.
register(svelteModule("terminal", "Terminal", Terminal));
register(svelteModule("browser", "Tarayıcı", Browser));
