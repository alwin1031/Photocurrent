import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import filtfilt
from scipy.signal import butter
from scipy.signal import find_peaks
import tkinter as tk
from tkinter import filedialog
import os
import matplotlib
from matplotlib.ticker import FormatStrFormatter


matplotlib.rcParams['agg.path.chunksize'] = 10000


def Baseline(df, ampfr, avgnum):
    shft = sum(df['Ampl'][0:avgnum]) / avgnum
    df['Ampl'] = [ampfr * (x - shft) for x in df['Ampl']]

    return df


def Correction(df, cb, ca):
    b, a = butter(cb, ca)
    filt_df = filtfilt(b, a, df['Ampl'])
    df['Ampl'] = [df['Ampl'][i] - filt_df[i] for i in range(len(df))]

    return df


def Findpeak(df, hh, dis):
    peaks, _ = find_peaks(df['Ampl'], height=hh, distance=dis)
    np.diff(peaks)

    fpk_df = pd.DataFrame(columns=['Time', 'Ampl'])
    fpk_df['Time'] = df['Time'][peaks]
    fpk_df['Ampl'] = df['Ampl'][peaks]

    return fpk_df


def Mean(df, min, max):
    sel = []
    df.reset_index(inplace=True)
    for i in range(len(df)):
        if (min <= df['Time'][i] <= max):
            sel.append(df['Ampl'][i])
    area = sum(sel)
    mean = area/len(sel)
    print("Photocurrent: {} nA".format(round(mean, 3)))


def Findtrend(df):
    ns = pd.DataFrame(columns=['Time', 'Ampl'])
    peaks, _ = find_peaks(df['Ampl'], prominence=(None, 0.6), distance=10)
    np.diff(peaks)
    ns["Time"] = df["Time"][peaks]
    ns["Ampl"] = df["Ampl"][peaks]

    return ns


def Figure(df, fpk_df, ymin, ymax):
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
    # plt.axvspan(0, 2.5, facecolor='purple', alpha=0.1)
    # plt.axvspan(2.5, 34.5, facecolor='b', alpha=0.1)
    # plt.axvspan(34.5, 45, facecolor='r', alpha=0.1)
    # plt.hlines(y=-10, xmin=hxmin, xmax=hxmax, linewidth=4, color='green')
    plt.plot(df["Time"], df["Ampl"], c="grey", lw=0.1, alpha=0.5)
    plt.plot([0, 1250000], [0, 0], 'k:')
    plt.plot(fpk_df["Time"], fpk_df["Ampl"], c="red")

    plt.axis([0, 45, ymin, ymax])
    plt.xlabel("Time (s)", fontdict=font1, labelpad=6)
    plt.ylabel("Photocurrent (nA)", fontdict=font1, labelpad=10)
    plt.xticks(fontsize=14)
    plt.yticks(fontsize=14)
    plt.subplots_adjust(bottom=0.14, left=0.16)
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
    2. Correction: (df, cb = 2, ca = 0.02)
    3. Findpeak: (df, hh = 0, dis = 1500)
    4. Baseline: (fpk_df, amp = 1, baseline = 150)
    5. Mean: (fpk_df, cal_min, cal_max)
    5. Figure: (df, fpk_df, ymin, ymax)
    Output: example.png
    """

    df = Baseline(df, 200, 1000)
    df = Correction(df, 2, 0.02)
    fpk_df = Findpeak(df, 0, 1500)
    fpk_df = Baseline(fpk_df, 1, 150)
    Mean(fpk_df, 20, 30)
    Figure(df, fpk_df, -20, 20)
    plt.savefig(input_path+".png")
    print('Done! d(//-v-)b')
