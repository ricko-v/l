export default function normalizeConfig(config) {
  const DISALLOWED_KEYS = [
    "FunctionArn",
    "CodeSize",
    "LastModified",
    "CodeSha256",
    "Version",
    "State",
    "LastUpdateStatus",
    "PackageType",
    "Architectures",
    "RuntimeVersionConfig",
    "SigningJobArn",
    "SigningProfileVersionArn",
    "VpcId",
    "OptimizationStatus",
  ];

  function deepClean(obj) {
    if (Array.isArray(obj)) {
      return obj.map(deepClean);
    } else if (obj && typeof obj === "object") {
      for (const key of Object.keys(obj)) {
        if (DISALLOWED_KEYS.includes(key)) {
          delete obj[key];
          // console.log(`🧹 Removed disallowed key: ${key}`);
        } else {
          obj[key] = deepClean(obj[key]);
        }
      }
    }
    return obj;
  }

  // Bersihkan semua field terlarang
  const cleaned = deepClean(config);

  // Konversi layers ke array ARN
  if (Array.isArray(cleaned.Layers)) {
    cleaned.Layers = cleaned.Layers.map((l) => l.Arn);
  }

  // Pastikan SnapStart valid
  cleaned.SnapStart = { ApplyOn: cleaned.SnapStart?.ApplyOn || "None" };

  // Susun ulang config sesuai schema AWS
  const newConfig = {
    FunctionName: cleaned.FunctionName || "",
    Role: cleaned.Role || "",
    Handler: cleaned.Handler || "",
    Description: cleaned.Description || "",
    Timeout: cleaned.Timeout || 10,
    MemorySize: cleaned.MemorySize || 128,
    VpcConfig: {
      SubnetIds: cleaned.VpcConfig?.SubnetIds || [],
      SecurityGroupIds: cleaned.VpcConfig?.SecurityGroupIds || [],
      Ipv6AllowedForDualStack:
        cleaned.VpcConfig?.Ipv6AllowedForDualStack ?? false,
    },
    Environment: cleaned.Environment || { Variables: {} },
    Runtime: cleaned.Runtime || "",
    Layers: cleaned.Layers || [],
  };

  return newConfig;
}
