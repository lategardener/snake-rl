from IPython.display import display, HTML


def display_training_summary(
        agent_uuid: str,
        algorithm: str,
        grid_size: int,
        timesteps: int,
        n_envs: int,
        relative_path: str,
        style: str = "glass"
):
    """
    Affiche un résumé stylisé de l'entraînement dans un notebook Jupyter.

    Args:
        agent_uuid: UUID unique de l'agent
        algorithm: Algorithme utilisé (ex: 'PPO')
        grid_size: Taille de la grille
        timesteps: Nombre total de timesteps d'entraînement
        n_envs: Nombre d'environnements parallèles
        relative_path: Chemin relatif de sauvegarde
        style: Style d'affichage ('glass', 'gradient' ou 'minimal')
    """

    if style == "glass":
        html_output = f"""
        <div style="
            background: rgba(20, 20, 30, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            padding: 30px;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5),
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 20px 0;
            position: relative;
        ">
            <!-- Effet de lumière -->
            <div style="
                position: absolute;
                top: -50%;
                right: -20%;
                width: 200px;
                height: 200px;
                background: radial-gradient(circle, rgba(138, 43, 226, 0.3) 0%, transparent 70%);
                filter: blur(60px);
                pointer-events: none;
            "></div>

            <div style="
                position: absolute;
                bottom: -30%;
                left: -10%;
                width: 150px;
                height: 150px;
                background: radial-gradient(circle, rgba(0, 191, 255, 0.3) 0%, transparent 70%);
                filter: blur(50px);
                pointer-events: none;
            "></div>

            <h2 style="
                color: #fff;
                margin: 0 0 25px 0;
                font-size: 28px;
                font-weight: 700;
                text-shadow: 0 2px 10px rgba(138, 43, 226, 0.5);
                letter-spacing: -0.5px;
            ">
                <span style="
                    background: linear-gradient(135deg, #8A2BE2 0%, #00BFFF 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                ">✓</span> Entraînement terminé
            </h2>

            <div style="
                background: rgba(255, 255, 255, 0.03);
                backdrop-filter: blur(10px);
                padding: 20px;
                border-radius: 15px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            ">
                <!-- UUID -->
                <div style="
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">UUID</div>
                    <div style="
                        background: rgba(138, 43, 226, 0.1);
                        padding: 8px 12px;
                        border-radius: 8px;
                        border: 1px solid rgba(138, 43, 226, 0.3);
                        font-family: 'Monaco', 'Courier New', monospace;
                        font-size: 13px;
                        color: #8A2BE2;
                        text-shadow: 0 0 10px rgba(138, 43, 226, 0.3);
                        flex: 1;
                    ">{agent_uuid}</div>
                </div>

                <!-- Algorithme -->
                <div style="
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">Algorithme</div>
                    <div style="
                        background: linear-gradient(135deg, rgba(138, 43, 226, 0.2) 0%, rgba(0, 191, 255, 0.2) 100%);
                        padding: 8px 12px;
                        border-radius: 8px;
                        border: 1px solid rgba(138, 43, 226, 0.3);
                        font-weight: 700;
                        font-size: 16px;
                        color: #00BFFF;
                        text-shadow: 0 0 10px rgba(0, 191, 255, 0.3);
                        flex: 1;
                    ">{algorithm}</div>
                </div>

                <!-- Grid Size -->
                <div style="
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">Grid Size</div>
                    <div style="
                        padding: 8px 12px;
                        border-radius: 8px;
                        font-weight: 700;
                        font-size: 16px;
                        color: #fff;
                        flex: 1;
                    ">{grid_size} × {grid_size}</div>
                </div>

                <!-- Timesteps -->
                <div style="
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">Timesteps</div>
                    <div style="
                        padding: 8px 12px;
                        border-radius: 8px;
                        font-weight: 700;
                        font-size: 16px;
                        color: #fff;
                        flex: 1;
                    ">{timesteps:,}</div>
                </div>

                <!-- Environnements -->
                <div style="
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">Environnements</div>
                    <div style="
                        padding: 8px 12px;
                        border-radius: 8px;
                        font-weight: 700;
                        font-size: 16px;
                        color: #fff;
                        flex: 1;
                    ">{n_envs}</div>
                </div>

                <!-- Chemin -->
                <div style="
                    display: flex;
                    align-items: center;
                ">
                    <div style="
                        color: rgba(255, 255, 255, 0.6);
                        font-weight: 600;
                        font-size: 13px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        width: 150px;
                        flex-shrink: 0;
                    ">Chemin</div>
                    <div style="
                        background: rgba(0, 0, 0, 0.3);
                        padding: 8px 12px;
                        border-radius: 8px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        font-family: 'Monaco', 'Courier New', monospace;
                        font-size: 12px;
                        color: rgba(255, 255, 255, 0.8);
                        word-break: break-all;
                        flex: 1;
                    ">{relative_path}</div>
                </div>
            </div>
        </div>
        """

    elif style == "gradient":
        html_output = f"""
        <div style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            border-radius: 10px;
            border-left: 5px solid #4CAF50;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 10px 0;
        ">
            <h3 style="color: #fff; margin: 0 0 15px 0; font-size: 20px;">
                ✓ Entraînement terminé
            </h3>
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 5px;">
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>UUID:</strong> 
                    <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 3px; color: #4CAF50;">
                        {agent_uuid}
                    </code>
                </p>
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>Algorithme:</strong> 
                    <span style="color: #4CAF50; font-weight: bold;">{algorithm}</span>
                </p>
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>Grid Size:</strong> 
                    <span style="color: #4CAF50; font-weight: bold;">{grid_size}x{grid_size}</span>
                </p>
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>Timesteps:</strong> 
                    <span style="color: #4CAF50; font-weight: bold;">{timesteps:,}</span>
                </p>
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>Environnements:</strong> 
                    <span style="color: #4CAF50; font-weight: bold;">{n_envs}</span>
                </p>
                <p style="color: #fff; margin: 8px 0; font-size: 14px;">
                    <strong>Chemin:</strong> 
                    <code style="background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 3px; color: #FFD700;">
                        {relative_path}
                    </code>
                </p>
            </div>
        </div>
        """

    elif style == "minimal":
        html_output = f"""
        <div style="
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #28a745;
            font-family: monospace;
            margin: 10px 0;
        ">
            <div style="color: #28a745; font-weight: bold; margin-bottom: 10px; font-size: 16px;">
                ✓ Entraînement terminé
            </div>
            <div style="color: #333; line-height: 1.8;">
                <div><strong>UUID:</strong> <span style="color: #6c757d;">{agent_uuid}</span></div>
                <div><strong>Algorithme:</strong> {algorithm} | <strong>Grid:</strong> {grid_size}x{grid_size}</div>
                <div><strong>Timesteps:</strong> {timesteps:,} | <strong>Envs:</strong> {n_envs}</div>
                <div><strong>Chemin:</strong> <code style="background: #e9ecef; padding: 2px 6px; border-radius: 3px;">{relative_path}</code></div>
            </div>
        </div>
        """

    else:
        raise ValueError(f"Style '{style}' non supporté. Utilisez 'glass', 'gradient' ou 'minimal'.")

    display(HTML(html_output))