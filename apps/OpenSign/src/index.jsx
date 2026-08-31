import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/dark-theme-improvements.css";
import App from "./App";
import { showUpgradeProgress, hideUpgradeProgress } from "./utils";
import { Provider } from "react-redux";
import { store } from "./redux/store";
import Parse from "parse";
import "./polyfills";
import { appInfo, serverUrl_fn } from "./constant/appinfo";
import "./i18n";
import { ScrollProvider } from "./context/ScrollPdfContext";

const appId =
  import.meta.env.VITE_APPID || process.env.REACT_APP_APPID || "opensign";
const serverUrl = serverUrl_fn();
Parse.initialize(appId);
Parse.serverURL = serverUrl;

// Refresh cached brand assets on every release so returning users do not keep
// the previous OpenSign logo from localStorage.
localStorage.setItem("appLogo", appInfo.applogo);
localStorage.setItem("favicon", appInfo.fev_Icon);
localStorage.setItem("appname", appInfo.appName);

if (localStorage.getItem("showUpgradeProgress")) {
  showUpgradeProgress();
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme !== "light") {
  document.documentElement.setAttribute("data-theme", "opensigndark");
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <Provider store={store}>
    <ScrollProvider>
      <App />
    </ScrollProvider>
  </Provider>
);

hideUpgradeProgress();
localStorage.removeItem("showUpgradeProgress");
