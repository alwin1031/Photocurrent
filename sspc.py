import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FormatStrFormatter


def Baseline(df, amp, num):
    shf = sum(df["Ampl"][0:num]) / num
    df["Ampl"] = [amp * (x - shf) for x in df["Ampl"]]
    return df


def Grouping(df):
    on_Ampl, on_Time, off_Ampl, off_Time = [], [], [], []
    for i in range(len(df["Time"])):
        if (0 <= df["Time"][i] < 0.85):
            on_Ampl.append(df["Ampl"][i])
            on_Time.append(df["Time"][i])
        elif (0.85 <= df["Time"][i]):
            off_Ampl.append(df["Ampl"][i])
            off_Time.append(df["Time"][i])

    on = pd.DataFrame(list(zip(on_Time, on_Ampl)), columns=['Time', 'Ampl'])
    off = pd.DataFrame(list(zip(off_Time, off_Ampl)), columns=['Time', 'Ampl'])
    return off, on


def Fitting(gp, j):
    cal_ampl, cal_time = [], []

    try:
        # Find critical amplitude
        cri_ampl = max([abs(x) for x in gp["Ampl"][0:250]])

        # Find critical time from critical amplitude
        for i in range(len(gp["Time"])):
            if (abs(gp["Ampl"][i]) == cri_ampl):
                cri_time = gp["Time"][i]
                break

        # Set analysis interval
        for i in range(len(gp["Time"])):
            if (gp["Time"][i] >= cri_time):
                cal_time.append(gp["Time"][i])
                cal_ampl.append(gp["Ampl"][i])

        # Curve Fitting
        # p = plateau /plato/
        def exp_func(x, a, tau, p):
            return (a-p)*np.exp(-(x/tau))+p

        from scipy.optimize import curve_fit
        popt, pcov = curve_fit(exp_func, cal_time, cal_ampl)

    except:
        print("Fitting failed! ~~~(.~.)>")

    else:
        fit_ampl = [exp_func(i, *popt) for i in cal_time]
        fit_cri = max(fit_ampl)
        fit_area = np.trapz(fit_ampl, dx=0.00016)
        hftime = np.log(2) * popt[1]
        sigma = np.sqrt(np.diag(pcov))
        print("cri_value{}: {} at {}".format(
            j, round(cri_ampl, 3), round(cri_time, 3)))
        print("fit_cri{}: {}".format(j, round(fit_cri, 3)))
        print("fit_area{}: {}".format(j, round(fit_area, 3)))
        print("hftime{}: {}".format(j, round(hftime, 3)))
        #print("sigma{}: {}".format(j, round(sigma, 3)))
        return cal_time, fit_ampl

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
    df = pd.read_csv(input_path, skiprows=4)
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
    gp = Grouping(df)
    fit_off = Fitting(gp[0], 0)
    fit_on = Fitting(gp[1], 1)
    Figure(df, fit_off, fit_on, -4, 6)
    plt.savefig(input_path+".png")
    print('Done! d(//-v-)b')
