import { register, svelteModule } from "../core/module";
import Terminal from "./terminal/Terminal.svelte";
import Browser from "./browser/Browser.svelte";
import ProjectPanel from "./project/ProjectPanel.svelte";
import Brain from "./brain/Brain.svelte";
import Placeholder from "./placeholder/Placeholder.svelte";
import Unity from "./unity/Unity.svelte";
import Routines from "./routines/Routines.svelte";
import Dashboard from "./dashboard/Dashboard.svelte";
import Repo from "./repo/Repo.svelte";

// New features: add a folder under modules/ and register it here.
register(svelteModule("terminal", "Terminal", Terminal));
register(svelteModule("browser", "Tarayıcı", Browser));
register(svelteModule("project", "Proje", ProjectPanel));
register(svelteModule("brain", "Beyin", Brain));
// Sidebar sections not built yet.
register(svelteModule("dashboard", "Dashboard", Dashboard));
register(svelteModule("routines", "Rutinler", Routines));
register(svelteModule("unity", "Unity", Unity));
register(svelteModule("cicd", "CI/CD", Placeholder));
register(svelteModule("repo", "Repo", Repo));
