import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
# from matplotlib.ticker import FormatStrFormatter


def Pre(info, cloff):
    count = int(info.iloc[0, 2])
    sep = (max(df['Time']) - min(df['Time'])) / (count - 1)
    print('You have', count, 'data points, spacing', sep, 'ms.')
    zero = int((0 - min(df['Time'])) / sep) + 1
    loff = int((cloff - min(df['Time'])) / sep) + 1
    print('0 at', zero, 'and light-off at', loff)

    return zero, loff


def Baseline(df, amp, num):
    shf = sum(df["Ampl"][0:num]) / num
    df["Ampl"] = [amp * (x - shf) for x in df["Ampl"]]

    return df


def Group(df, zero, loff):
    on = (df.iloc[zero:loff, :]).reset_index(drop=True)
    off = (df.iloc[loff:, :]).reset_index(drop=True)

    return off, on


def Fitting(gp, j):
    try:
        # Find critical amplitude
        cri_ampl = max([abs(x) for x in gp["Ampl"][0:250]])
        k = 0

        # Find critical time from critical amplitude
        for i in range(len(gp["Time"])):
            if (abs(gp["Ampl"][i]) == cri_ampl):
                cri_time = gp["Time"][i]
                k = i
                print(i)
                break

        # Set analysis interval
        fit = (gp.iloc[k:, :])

        # Curve Fitting
        def exp_func(x, a, tau, p):
            return (a-p)*np.exp(-(x/tau))+p

        from scipy.optimize import curve_fit
        popt, pcov = curve_fit(exp_func, fit['Time'], fit['Ampl'])

    except:
        print("Fitting failed! ~~~(.~.)>")

    else:
        fit_ampl = [exp_func(i, *popt) for i in fit['Time']]
        fit_cri = max(fit_ampl)
        # fit_area = np.trapz(fit_ampl, dx=0.00016)
        hftime = np.log(2) * popt[1]
        # sigma = np.sqrt(np.diag(pcov))
        print("critical value{}: {} at {}".format(
            j, round(cri_ampl, 3), round(cri_time, 3)))
        print("fit critical value{}: {}".format(j, round(fit_cri, 3)))
        # print("fit_area{}: {}".format(j, round(fit_area, 3)))
        print("half time{}: {}".format(j, round(hftime, 3)))
        # print("sigma{}: {}".format(j, round(sigma, 3)))
        return fit['Time'], fit_ampl

    finally:
        pass


def Figure(df, fit_off, fit_on, ymin, ymax):
    fig, ax = plt.subplots(dpi=600, figsize=(8, 6))
    ax.spines['right'].set_visible(False)
    ax.spines['top'].set_visible(False)
    ax.tick_params(width=1.8)
    # ax.yaxis.set_major_formatter(FormatStrFormatter('%.2f'))
    for axis in ['bottom', 'left']:
        ax.spines[axis].set_linewidth(1.8)
    font1 = {'family': 'arial', 'color':  'black',
             'weight': 'bold', 'size': 18}
    font2 = {'family': 'arial', 'color':  'black',
             'weight': 'bold', 'size': 26}
    plt.axvspan(0, 0.85, facecolor='g', alpha=0.1)
    plt.plot(df["Time"], df["Ampl"], c="grey", lw=0.5, alpha=0.4)
    plt.plot([-0.2, 2.0], [0, 0], 'k:')
    plt.plot(fit_off[0], fit_off[1], 'r')
    plt.plot(fit_on[0], fit_on[1], 'r')
    plt.axis([-0.2, 2.0, ymin, ymax])   # change [xmin, xmax, ymin, ymax]
    plt.xlabel("Time (s)", fontdict=font1, labelpad=10)
    plt.ylabel("Photocurrent (nA)", fontdict=font1, labelpad=10)
    plt.xticks(fontsize=14)
    plt.yticks(fontsize=14)
    plt.subplots_adjust(bottom=0.14, left=0.14)
    plt.title(title, fontdict=font2, pad=20)


if __name__ == '__main__':
    import sys
    import os
    input_path = sys.argv[1]
    title = sys.argv[2]
    info = pd.read_csv(input_path, nrows=1)
    df = pd.read_csv(input_path, skiprows=4)
    pre = Pre(info, 0.85)
    input_path = os.path.splitext(input_path)[0]

    """
    Input: python main.py directory/example.csv example_name
    1. Baseline: (dataframe, amplifier = 200, baseline data length = 1000)
    2. Grouping: (df), Divide data into "light-off" & "light-on", gp"[0]=light-off" and "[1]=light-on"
    3. Fitting: (gp[0/1], 0/1)
    4. Figure: (df, fit_off, fit_on, ymin, ymax)
    Output: example.png
    """

    df = Baseline(df, 200, 1000)
    gp = Group(df, pre[0], pre[1])
    fit_off = Fitting(gp[0], 0)
    fit_on = Fitting(gp[1], 1)
    Figure(df, fit_off, fit_on, -4, 6)
    plt.savefig(input_path+".png")
    print('Done! d(//-v-)b')
