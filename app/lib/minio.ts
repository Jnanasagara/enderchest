import { Client } from "minio";

export const minioClient = new Client({
    endPoint: "minio",
    port: 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USER!,
    secretKey: process.env.MINIO_ROOT_PASSWORD!,
});