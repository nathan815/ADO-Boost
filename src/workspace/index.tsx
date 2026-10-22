import React from "react";
import { render } from "react-dom";
import coreStyles from "azure-devops-ui/Core/core.css?inline";
import buttonStyles from "azure-devops-ui/Components/Button/Button.css?inline";
import styles from "./workspace.css?inline";
import { WorkspaceClient, WorkspaceQueries } from "./client";
import { WorkspaceService } from "./service";
import { WorkspaceApp } from "./app";

const style = document.createElement("style");
style.textContent = `${coreStyles}\n${buttonStyles}\n${styles}`;
document.head.append(style);
const client = new WorkspaceClient();
const queries = new WorkspaceQueries(client);
render(<WorkspaceApp client={client} queries={queries} service={new WorkspaceService(queries)} />, document.getElementById("app"));
