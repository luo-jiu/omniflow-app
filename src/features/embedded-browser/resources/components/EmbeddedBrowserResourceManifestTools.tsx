import { Toast } from '@douyinfe/semi-ui';
import React from 'react';
import type { EmbeddedBrowserHlsManifest } from '../model/embedded-browser-hls-manifest';
import type { EmbeddedBrowserHlsKeyVerificationResult } from '../model/embedded-browser-hls-key-verifier';
import type { EmbeddedBrowserMpdManifest } from '../model/embedded-browser-mpd-manifest';
import {
  analyzeHlsResource,
  analyzeMpdResource,
  isHlsResource,
  isMpdResource,
  saveHlsResourceWithFfmpeg,
  saveMpdResourceWithFfmpeg,
  verifyHlsResourceKey,
} from '../services/embedded-browser-resource-panel-actions';
import type { EmbeddedBrowserCapturedResource } from '../types';

type HlsAnalysisState = {
  error?: string
  keyVerification?: EmbeddedBrowserHlsKeyVerificationResult
  keyVerificationLoading?: boolean
  loading: boolean
  manifest?: EmbeddedBrowserHlsManifest
  planText?: string
  saveLoading?: boolean
}

type MpdAnalysisState = {
  error?: string
  loading: boolean
  manifest?: EmbeddedBrowserMpdManifest
  planText?: string
  saveLoading?: boolean
}

type EmbeddedBrowserResourceManifestToolsProps = {
  resource: EmbeddedBrowserCapturedResource
  resources: EmbeddedBrowserCapturedResource[]
}

const EmbeddedBrowserResourceManifestTools: React.FC<EmbeddedBrowserResourceManifestToolsProps> = ({
  resource,
  resources,
}) => {
  const [hlsAnalysis, setHlsAnalysis] = React.useState<HlsAnalysisState>({ loading: false });
  const [mpdAnalysis, setMpdAnalysis] = React.useState<MpdAnalysisState>({ loading: false });
  const canAnalyzeHls = isHlsResource(resource);
  const canAnalyzeMpd = isMpdResource(resource);

  const handleAnalyzeHls = React.useCallback(() => {
    setHlsAnalysis((previous) => ({
      ...previous,
      error: undefined,
      loading: true,
    }));
    void analyzeHlsResource(resource)
      .then((result) => {
        setHlsAnalysis({
          keyVerification: undefined,
          keyVerificationLoading: false,
          loading: false,
          manifest: result.manifest,
          planText: result.planText,
        });
        Toast.success('HLS 解析完成，下载计划 JSON 已复制');
      })
      .catch((error: any) => {
        setHlsAnalysis({
          error: error?.message || 'HLS 解析失败',
          keyVerificationLoading: false,
          loading: false,
        });
        Toast.error(error?.message || 'HLS 解析失败');
      });
  }, [resource]);

  const handleAnalyzeMpd = React.useCallback(() => {
    setMpdAnalysis((previous) => ({
      ...previous,
      error: undefined,
      loading: true,
    }));
    void analyzeMpdResource(resource)
      .then((result) => {
        setMpdAnalysis({
          loading: false,
          manifest: result.manifest,
          planText: result.planText,
        });
        Toast.success('MPD 解析完成，下载计划 JSON 已复制');
      })
      .catch((error: any) => {
        setMpdAnalysis({
          error: error?.message || 'MPD 解析失败',
          loading: false,
        });
        Toast.error(error?.message || 'MPD 解析失败');
      });
  }, [resource]);

  const handleVerifyHlsKey = React.useCallback(() => {
    if (!hlsAnalysis.manifest) {
      return;
    }
    setHlsAnalysis((previous) => ({
      ...previous,
      error: undefined,
      keyVerification: undefined,
      keyVerificationLoading: true,
    }));
    void verifyHlsResourceKey({
      manifest: hlsAnalysis.manifest,
      manifestResource: resource,
      resources,
    })
      .then((result) => {
        setHlsAnalysis((previous) => ({
          ...previous,
          keyVerification: result,
          keyVerificationLoading: false,
        }));
        if (result.mediaAlreadyReadable) {
          Toast.success('片段本身可读，不需要 key');
          return;
        }
        if (result.ok && result.candidate) {
          Toast.success('已验证到可用 key');
          return;
        }
        Toast.warning(result.error || '没有验证到可用 key');
      })
      .catch((error: any) => {
        setHlsAnalysis((previous) => ({
          ...previous,
          keyVerification: {
            error: error?.message || 'key 验证失败',
            mediaAlreadyReadable: false,
            ok: false,
          },
          keyVerificationLoading: false,
        }));
        Toast.error(error?.message || 'key 验证失败');
      });
  }, [hlsAnalysis.manifest, resource, resources]);

  const handleSaveHls = React.useCallback(() => {
    setHlsAnalysis((previous) => ({
      ...previous,
      saveLoading: true,
    }));
    void saveHlsResourceWithFfmpeg(resource)
      .then((result) => {
        if (result.cancelled) {
          return;
        }
        Toast.success('HLS 已保存到本地');
      })
      .catch((error: any) => {
        Toast.error(error?.message || 'HLS 保存失败');
      })
      .finally(() => {
        setHlsAnalysis((previous) => ({
          ...previous,
          saveLoading: false,
        }));
      });
  }, [resource]);

  const handleSaveMpd = React.useCallback(() => {
    setMpdAnalysis((previous) => ({
      ...previous,
      saveLoading: true,
    }));
    void saveMpdResourceWithFfmpeg(resource)
      .then((result) => {
        if (result.cancelled) {
          return;
        }
        Toast.success('MPD 已保存到本地');
      })
      .catch((error: any) => {
        Toast.error(error?.message || 'MPD 保存失败');
      })
      .finally(() => {
        setMpdAnalysis((previous) => ({
          ...previous,
          saveLoading: false,
        }));
      });
  }, [resource]);

  if (!canAnalyzeHls && !canAnalyzeMpd) {
    return null;
  }

  return (
    <>
      {hlsAnalysis.manifest ? (
        <div className="resource-hls-analysis">
          <div>
            <strong>HLS：</strong>
            {hlsAnalysis.manifest.isMaster ? 'Master playlist' : 'Media playlist'}
            {' · '}
            {hlsAnalysis.manifest.isLive ? '直播' : '点播'}
          </div>
          <div>
            variants {hlsAnalysis.manifest.variants.length}
            {' · '}
            segments {hlsAnalysis.manifest.segmentCount}
            {' · '}
            keys {hlsAnalysis.manifest.keys.length}
            {' · '}
            maps {hlsAnalysis.manifest.maps.length}
            {' · '}
            {Math.round(hlsAnalysis.manifest.durationSeconds)}s
          </div>
          {hlsAnalysis.manifest.variants[0] ? (
            <code>{hlsAnalysis.manifest.variants[0].url}</code>
          ) : hlsAnalysis.manifest.segments[0] ? (
            <code>{hlsAnalysis.manifest.segments[0].url}</code>
          ) : null}
          {hlsAnalysis.keyVerification ? (
            <div>
              <strong>key 验证：</strong>
              {hlsAnalysis.keyVerification.mediaAlreadyReadable
                ? '片段本身可读，不需要 key'
                : hlsAnalysis.keyVerification.ok && hlsAnalysis.keyVerification.candidate
                  ? `命中 ${hlsAnalysis.keyVerification.candidate.label}`
                  : hlsAnalysis.keyVerification.error || '未命中'}
            </div>
          ) : null}
        </div>
      ) : hlsAnalysis.error ? (
        <div className="resource-hls-analysis">
          HLS 解析失败：{hlsAnalysis.error}
        </div>
      ) : null}
      {mpdAnalysis.manifest ? (
        <div className="resource-hls-analysis">
          <div>
            <strong>MPD：</strong>
            {mpdAnalysis.manifest.hasDrm ? '检测到 DRM' : '未检测到 DRM'}
            {' · '}
            representations {mpdAnalysis.manifest.representations.length}
            {' · '}
            {Math.round(mpdAnalysis.manifest.durationSeconds || 0)}s
          </div>
          <div>
            video {mpdAnalysis.manifest.representations.filter((item) => item.contentType === 'video').length}
            {' · '}
            audio {mpdAnalysis.manifest.representations.filter((item) => item.contentType === 'audio').length}
          </div>
          {mpdAnalysis.manifest.protections[0] ? (
            <code>{mpdAnalysis.manifest.protections[0].encryptionType}</code>
          ) : mpdAnalysis.manifest.representations[0]?.segments[0] ? (
            <code>{mpdAnalysis.manifest.representations[0].segments[0].url}</code>
          ) : mpdAnalysis.manifest.representations[0]?.initializationUrl ? (
            <code>{mpdAnalysis.manifest.representations[0].initializationUrl}</code>
          ) : null}
        </div>
      ) : mpdAnalysis.error ? (
        <div className="resource-hls-analysis">
          MPD 解析失败：{mpdAnalysis.error}
        </div>
      ) : null}
      <div className="resource-card-actions">
        {canAnalyzeHls ? (
          <>
            <button
              type="button"
              className="resource-card-btn primary"
              disabled={hlsAnalysis.saveLoading}
              onClick={handleSaveHls}
            >
              {hlsAnalysis.saveLoading ? '保存中' : '保存 HLS'}
            </button>
            <button
              type="button"
              className="resource-card-btn"
              disabled={hlsAnalysis.loading}
              onClick={handleAnalyzeHls}
            >
              {hlsAnalysis.loading ? '解析中' : '解析 HLS'}
            </button>
            {hlsAnalysis.planText ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(hlsAnalysis.planText || '').then(() => {
                    Toast.success('下载计划 JSON 已复制');
                  });
                }}
              >
                复制计划
              </button>
            ) : null}
            {hlsAnalysis.manifest?.keys.length ? (
              <button
                type="button"
                className="resource-card-btn"
                disabled={hlsAnalysis.keyVerificationLoading}
                onClick={handleVerifyHlsKey}
              >
                {hlsAnalysis.keyVerificationLoading ? '验证中' : '验证 key'}
              </button>
            ) : null}
          </>
        ) : null}
        {canAnalyzeMpd ? (
          <>
            <button
              type="button"
              className="resource-card-btn primary"
              disabled={mpdAnalysis.saveLoading}
              onClick={handleSaveMpd}
            >
              {mpdAnalysis.saveLoading ? '保存中' : '保存 MPD'}
            </button>
            <button
              type="button"
              className="resource-card-btn"
              disabled={mpdAnalysis.loading}
              onClick={handleAnalyzeMpd}
            >
              {mpdAnalysis.loading ? '解析中' : '解析 MPD'}
            </button>
            {mpdAnalysis.planText ? (
              <button
                type="button"
                className="resource-card-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(mpdAnalysis.planText || '').then(() => {
                    Toast.success('下载计划 JSON 已复制');
                  });
                }}
              >
                复制计划
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
};

export default EmbeddedBrowserResourceManifestTools;
