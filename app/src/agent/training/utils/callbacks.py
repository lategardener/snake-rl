import mlflow
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.utils import safe_mean


class MLflowLoggingCallback(BaseCallback):
    def __init__(self, verbose=0):
        super().__init__(verbose)
    def _on_step(self) -> bool:
        return True
    def _on_rollout_end(self) -> None:
        try:
            logger_values = getattr(self.logger, "name_to_value", {})
            metrics = {k: float(v) for k, v in logger_values.items()}
            if hasattr(self.model, "ep_info_buffer") and len(self.model.ep_info_buffer) > 0:
                metrics["rollout/ep_rew_mean"] = float(safe_mean([ep["r"] for ep in self.model.ep_info_buffer]))
                metrics["rollout/ep_len_mean"] = float(safe_mean([ep["l"] for ep in self.model.ep_info_buffer]))
            if metrics:
                mlflow.log_metrics(metrics, step=self.num_timesteps)
        except Exception:
            pass