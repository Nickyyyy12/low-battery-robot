package Game;

public class Robot {
    private String name;
    private int currentBattery;
    private int  maxBattery;

    public Robot(String name, int currentBattery, int maxBattery){
        setName(name);
        setMaxBattery(maxBattery);
        setCurrentBattery(currentBattery);
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setCurrentBattery(int currentBattery) {
        if (currentBattery<0){
            this.currentBattery = 0;
        }else if (currentBattery>maxBattery){
            this.currentBattery = maxBattery;
        }else {
            this.currentBattery = currentBattery;
        }
    }

    public int getCurrentBattery() {
        return currentBattery;
    }

    public void setMaxBattery(int maxBattery) {
        if (maxBattery<=0){
            this.maxBattery = 1;
        }else {
            this.maxBattery = maxBattery;
        }

        if (currentBattery>this.maxBattery){
            currentBattery = this.maxBattery;
        }

    }

    public int getMaxBattery() {
        return maxBattery;
    }

    public void consumeBattery(int amount){
        if (amount<=0){
            amount = 0;
        }
        setCurrentBattery(this.currentBattery - amount);
    }

    public void recharge(int amount){
        if (amount<=0){
            amount = 0;
        }
        setCurrentBattery(this.currentBattery+amount);
    }

    public boolean isOutOfPower() {
        if (currentBattery<=0){
            return true;
        }else {
            return false;
        }
    }

    public void showStatus() {
        System.out.println(this.name + " Battery: " + this.currentBattery + " / " + this.maxBattery);
    }
}

