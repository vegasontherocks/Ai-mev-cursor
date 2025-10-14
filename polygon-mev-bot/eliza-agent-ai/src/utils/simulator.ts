import { ethers } from "ethers";

export interface SimulationRequest {
    to: string;
    from?: string;
    data?: string;
    value?: string | number;
    gasLimit?: number | string;
    maxFeePerGas?: any;
    maxPriorityFeePerGas?: any;
}

export interface SimulationResult {
    success: boolean;
    gasEstimate?: string;
    gasPriceGwei?: number;
    revertReason?: string;
    error?: string;
}

type Mode = 'rpc' | 'tenderly';

export class Simulator {
    private mode: Mode;
    private rpcUrl?: string;
    private tenderly?: { user: string; project: string; accessKey: string; networkId: string };

    constructor(opts?: {
        mode?: Mode;
        rpcUrl?: string;
        tenderly?: { user: string; project: string; accessKey: string; networkId?: string };
    }) {
        this.mode = opts?.mode || 'rpc';
        this.rpcUrl = opts?.rpcUrl;
        this.tenderly = opts?.tenderly
            ? { ...opts.tenderly, networkId: opts.tenderly.networkId || '137' }
            : undefined;
    }

    async simulate(tx: SimulationRequest): Promise<SimulationResult> {
        if (this.mode === 'tenderly') {
            if (!this.tenderly) return { success: false, error: 'Tenderly config missing' };
            try {
                const body = {
                    network_id: this.tenderly.networkId,
                    save_if_fails: true,
                    from: tx.from,
                    to: tx.to,
                    input: tx.data || '0x',
                    gas: tx.gasLimit ? Number(tx.gasLimit) : undefined,
                    gas_price: tx.maxFeePerGas ? String(tx.maxFeePerGas) : undefined,
                    value: tx.value ? String(tx.value) : '0',
                } as any;

                const fetchFn = (globalThis as any).fetch;
                if (!fetchFn) return { success: false, error: 'fetch not available in this environment' };

                const url = `https://api.tenderly.co/api/v1/account/${this.tenderly.user}/project/${this.tenderly.project}/simulate`;
                const res = await fetchFn(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Access-Key': this.tenderly.accessKey,
                    },
                    body: JSON.stringify(body),
                });

                if (!res.ok) {
                    const text = await res.text();
                    return { success: false, error: `Tenderly HTTP ${res.status}: ${text}` };
                }
                const json = await res.json();
                const success = json?.transaction?.status === true || json?.simulation?.status === true;
                const gasUsed = json?.simulation?.gas_used || json?.transaction?.gas_used;
                return {
                    success: !!success,
                    gasEstimate: gasUsed ? String(gasUsed) : undefined,
                    revertReason: success ? undefined : json?.error_message || json?.simulation?.error_message,
                };
            } catch (e: any) {
                return { success: false, error: e?.message || String(e) };
            }
        }

        // Default: RPC simulate
        const provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
        try {
            const txReq: any = {
                to: tx.to,
                data: tx.data || '0x',
                value: tx.value || 0,
                gasLimit: tx.gasLimit,
                maxFeePerGas: tx.maxFeePerGas,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
                from: tx.from,
            };
            const gasEstimate = await provider.estimateGas(txReq);
            await provider.call(txReq);
            let gasPriceGwei = 0;
            try {
                const fee: any = await provider.getFeeData();
                if (fee.maxFeePerGas) gasPriceGwei = parseFloat(ethers.utils.formatUnits(fee.maxFeePerGas, 'gwei'));
                else if (fee.gasPrice) gasPriceGwei = parseFloat(ethers.utils.formatUnits(fee.gasPrice, 'gwei'));
            } catch { }
            return { success: true, gasEstimate: gasEstimate.toString(), gasPriceGwei };
        } catch (e: any) {
            const revertReason = e?.reason || e?.error?.message || e?.data || e?.message;
            return { success: false, error: e?.message || String(e), revertReason };
        }
    }
}
